// Checks a program: the types of its expressions, its conversions and its warnings.
import {
  type Declaration,
  type Expression,
  type NamedType,
  type FunctionLiteral,
  type Import,
  type Program,
  type Statement,
  type TypeDeclaration,
} from './ast.ts'
import { CompileError, CompileWarning } from './errors.ts'
import { Functions, parameter_types, type FunctionEntry } from './functions.ts'
import { Imports, type Export } from './imports.ts'
import { function_symbol } from './lerta_ir.ts'
import { is_file_import, with_module_path, type Module } from './loader.ts'
import { std_modules } from './std_modules.ts'
import { ObjectTypes, type FieldInfo, type ObjectInfo } from './object_types.ts'
import { StatementChecker } from './statement_checker.ts'
import { TopLevelValues } from './top_level_values.ts'
import { TypeResolver } from './type_names.ts'
import { same_type, void_type, type Type } from './types.ts'

// The type of every expression in a checked program, and the type that the name of `x is T`
// stands for.
export type Types = Map<Expression | NamedType, Type>
// The type an expression is converted to where it is used, such as an Int passed as an Int?.
export type Conversions = Map<Expression, Type>

// Warnings are found as scopes end; they are reported in source order.
const in_source_order = (warnings: CompileWarning[]): CompileWarning[] =>
  warnings.toSorted((a, b) => a.line - b.line || a.column - b.column)

// What all the checkers of one program share.
export type Shared = {
  types: Types
  conversions: Conversions
  warnings: CompileWarning[]
  functions: Functions
  objects: ObjectTypes
  resolver: TypeResolver
  imports: Imports
  top_level: TopLevelValues
}

// The object that `@` refers to: in a method, or in the initializer of a field, which sees the
// constructor arguments and the fields initialized before it.
export type SelfContext = { info: ObjectInfo; initializing: FieldInfo | undefined }

// The function whose body is being checked: its written return type, or the one being inferred.
export type FunctionContext = {
  annotated: Type | undefined
  inferred: Type | undefined
  // The returned values, converted to the return type once it is known.
  results: { value: Expression; type: Type }[]
}

export type Checked = {
  types: Types
  conversions: Conversions
  objects: ObjectTypes
  imports: Imports
  warnings: CompileWarning[]
  // What the module exports, for the modules that import it.
  exports: Map<string, Export>
}

// Checks the modules in order, each after those it imports (see load_modules). The warnings of
// all the modules come back with the last one's, or with the error.
export const check_modules = (modules: Module[]): Checked[] => {
  const checked: Checked[] = []
  const warnings: CompileWarning[] = []
  const type_modules = new Map<string, Module>()
  const program_infos = new Map<string, ObjectInfo>()
  try {
    for (const module of modules) {
      const exports_of = (statement: Import) =>
        is_file_import(statement)
          ? checked[module.imported.get(statement)!.index].exports
          : std_modules.get(statement.module)
      const result = with_module_path(module.display_path, () => {
        reject_type_declared_elsewhere(module, type_modules)
        return check(module, exports_of, program_infos)
      })
      for (const warning of result.warnings) warning.module_path = module.display_path
      warnings.push(...result.warnings)
      checked.push(result)
    }
  } catch (error) {
    if (error instanceof CompileError) error.warnings = [...warnings, ...error.warnings]
    throw error
  }
  checked.at(-1)!.warnings = warnings
  return checked
}

// A class or struct is known by its name in the generated code, so the name must be unique
// across the program so far.
const reject_type_declared_elsewhere = (module: Module, type_modules: Map<string, Module>) => {
  for (const statement of module.program) {
    if (statement.kind !== 'type_declaration') continue
    const { name } = statement
    const other = type_modules.get(name.name)
    if (other !== undefined) {
      const where = other.display_path ?? 'the entry module'
      const message = `a type named '${name.name}' is declared in ${where} too; type names must be unique across the program so far`
      throw new CompileError(message, name.line, name.column)
    }
    type_modules.set(name.name, module)
  }
}

const check = (
  module: Module,
  exports_of: (statement: Import) => Map<string, Export> | undefined,
  program_infos: Map<string, ObjectInfo>,
): Checked => {
  const { program } = module
  const types: Types = new Map()
  const conversions: Conversions = new Map()
  const warnings: CompileWarning[] = []
  const imports = new Imports(exports_of)
  // An imported type, marking its import as used.
  const imported_type = (name: string) => {
    const imported = imports.get(name)
    if (imported?.export.kind !== 'type') return undefined
    imports.use(name)
    return imported.export
  }
  const objects: ObjectTypes = new ObjectTypes(
    (info) => check_object(shared, info),
    (name) => imported_type(name)?.info,
    program_infos,
  )
  const resolver = new TypeResolver(
    (name) => objects.object_type(name) ?? imported_type(name)?.type,
  )
  const functions: Functions = new Functions((entry) => check_function(shared, entry), resolver)
  const top_level = new TopLevelValues(program)
  const shared: Shared = {
    types,
    conversions,
    warnings,
    functions,
    objects,
    resolver,
    imports,
    top_level,
  }
  try {
    objects.add(
      program.filter(
        (statement): statement is TypeDeclaration => statement.kind === 'type_declaration',
      ),
    )
    for (const statement of program) {
      if (statement.kind === 'type_alias') resolver.add_alias(statement)
    }
    imports.add(
      program,
      (name) => objects.object_type(name) !== undefined || resolver.has_alias(name),
    )
    resolver.resolve_aliases()
    add_top_level_functions(program, functions, objects, resolver, imports)
    objects.add_members(resolver, functions)
    const warn_unused_top_level = new StatementChecker(
      shared,
      undefined,
      undefined,
    ).check_top_level(program)
    objects.check_all()
    functions.check_all()
    warn_unused_top_level()
    warnings.push(...imports.unused_warnings())
  } catch (error) {
    if (error instanceof CompileError) error.warnings = in_source_order(warnings)
    throw error
  }
  const exports = exports_of_module(module, functions, objects, resolver)
  return { types, conversions, objects, imports, warnings: in_source_order(warnings), exports }
}

const exports_of_module = (
  module: Module,
  functions: Functions,
  objects: ObjectTypes,
  resolver: TypeResolver,
): Map<string, Export> => {
  const exports = new Map<string, Export>()
  for (const statement of module.program) {
    if (!('exported' in statement && statement.exported)) continue
    const { name } = statement
    if (statement.kind === 'declaration') {
      const type = functions.type_of(name.name, name)!
      const symbol = function_symbol(module.index, name.name)
      exports.set(name.name, { kind: 'lerta_function', type, symbol })
    } else if (statement.kind === 'type_declaration') {
      const type = objects.object_type(name.name)!
      exports.set(name.name, { kind: 'type', type, info: objects.info(type) })
    } else {
      exports.set(name.name, { kind: 'type', type: resolver.alias_type(name), info: undefined })
    }
  }
  return exports
}

const is_function_declaration = (statement: Statement): statement is Declaration =>
  statement.kind === 'declaration' && statement.value.kind === 'function'

const add_top_level_functions = (
  program: Program,
  functions: Functions,
  objects: ObjectTypes,
  resolver: TypeResolver,
  imports: Imports,
): void => {
  for (const statement of program.filter(is_function_declaration)) {
    if (statement.mutable) {
      const message = 'a function must be declared with const'
      throw new CompileError(message, statement.line, statement.column)
    }
    const { name } = statement
    const is_taken =
      objects.object_type(name.name) !== undefined ||
      resolver.has_alias(name.name) ||
      imports.has(name.name)
    if (is_taken) {
      throw new CompileError(`'${name.name}' is already defined`, name.line, name.column)
    }
    functions.add(name.name, name, statement.value as FunctionLiteral)
  }
}

const check_function = (shared: Shared, entry: FunctionEntry): void => {
  const { literal } = entry
  const params = parameter_types(literal, shared.resolver)
  const context: FunctionContext = {
    annotated: entry.type?.kind === 'function' ? entry.type.result : undefined,
    inferred: undefined,
    results: [],
  }
  const self =
    entry.this_type === undefined
      ? undefined
      : { info: shared.objects.info(entry.this_type), initializing: undefined }
  new StatementChecker(shared, context, self).check_function_body(literal, params)
  const result = context.annotated ?? context.inferred ?? void_type
  if (result.kind === 'nil') {
    const message = 'nil alone does not give the return type; write it, as in `(): String? ->`'
    throw new CompileError(message, literal.line, literal.column)
  }
  for (const { value, type } of context.results) {
    if (type.kind !== 'never' && !same_type(type, result)) shared.conversions.set(value, result)
  }
  entry.type ??= { kind: 'function', params, result }
  shared.types.set(literal, entry.type)
}

const check_object = (shared: Shared, info: ObjectInfo): void => {
  const self: SelfContext = { info, initializing: undefined }
  new StatementChecker(shared, undefined, self).check_initializers()
}
