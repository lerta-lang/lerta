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
import { function_symbol, top_level_symbol } from './lerta_ir.ts'
import { is_file_import, with_module_path, type Module } from './loader.ts'
import { std_modules } from './std_modules.ts'
import { ObjectTypes, type FieldInfo, type ObjectInfo } from './object_types.ts'
import { finish_function_type } from './result_checker.ts'
import { StatementChecker } from './statement_checker.ts'
import { reject_misplaced_jumps } from './jump_positions.ts'
import { TopLevelValues } from './top_level_values.ts'
import { TypeResolver } from './type_names.ts'
import type { Type } from './types.ts'

// The type of every expression in a checked program, and the type that the name of `x is T`
// stands for.
export type Types = Map<Expression | NamedType, Type>
// The type an expression is converted to where it is used, such as an Int passed as an Int?.
export type Conversions = Map<Expression, Type>
// What each function literal that is not a top-level function captures from around it: the names
// and the types they have there, which may be narrowed.
export type Capture = { name: string; type: Type }
export type Captures = Map<FunctionLiteral, Capture[]>

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
  captures: Captures
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
  captures: Captures
  // What the module exports, for the modules that import it.
  exports: Map<string, Export>
}

// Checks the modules in order, each after those it imports (see load_modules). The warnings of
// all the modules come back with the last one's, or with the error.
export const check_modules = (modules: Module[]): Checked[] => {
  const checked: Checked[] = []
  const warnings: CompileWarning[] = []
  const program_infos = new Map<string, ObjectInfo>()
  try {
    for (const module of modules) {
      const exports_of = (statement: Import) =>
        is_file_import(statement)
          ? checked[module.imported.get(statement)!.index].exports
          : std_modules.get(statement.module)
      const result = with_module_path(module.display_path, () =>
        check(module, exports_of, program_infos),
      )
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

const check = (
  module: Module,
  exports_of: (statement: Import) => Map<string, Export> | undefined,
  program_infos: Map<string, ObjectInfo>,
): Checked => {
  const { program } = module
  const shared = create_shared(module, exports_of, program_infos)
  const { types, conversions, warnings, functions, objects, resolver, imports, captures } = shared
  try {
    reject_misplaced_jumps(program)
    declare_names(program, shared)
    check_code(program, shared)
  } catch (error) {
    if (error instanceof CompileError) error.warnings = in_source_order(warnings)
    throw error
  }
  const exports = exports_of_module(module, functions, objects, resolver, types)
  return {
    types,
    conversions,
    objects,
    imports,
    warnings: in_source_order(warnings),
    captures,
    exports,
  }
}

const create_shared = (
  module: Module,
  exports_of: (statement: Import) => Map<string, Export> | undefined,
  program_infos: Map<string, ObjectInfo>,
): Shared => {
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
    module.index,
    module.display_path ?? 'the entry module',
  )
  const resolver = new TypeResolver(
    (name) => objects.object_type(name) ?? imported_type(name)?.type,
  )
  const functions: Functions = new Functions((entry) => check_function(shared, entry), resolver)
  const shared: Shared = {
    types: new Map(),
    conversions: new Map(),
    warnings: [],
    functions,
    objects,
    resolver,
    imports,
    top_level: new TopLevelValues(module.program),
    captures: new Map(),
  }
  return shared
}

// The module's types, aliases, imports, functions and members, which the code may use before
// their declarations.
const declare_names = (program: Program, shared: Shared): void => {
  const { objects, resolver, imports, functions } = shared
  objects.add(
    program.filter(
      (statement): statement is TypeDeclaration => statement.kind === 'type_declaration',
    ),
  )
  for (const statement of program) {
    if (statement.kind === 'type_alias') resolver.add_alias(statement)
  }
  imports.add(program)
  reject_types_named_like_imports(program, imports)
  resolver.resolve_aliases()
  add_top_level_functions(program, functions, objects, resolver, imports)
  objects.add_members(resolver, functions)
}

// The top-level code, then the objects and functions, which may use its names.
const check_code = (program: Program, shared: Shared): void => {
  const warn_unused_top_level = new StatementChecker(shared, undefined, undefined).check_top_level(
    program,
  )
  shared.objects.check_all()
  shared.functions.check_all()
  warn_unused_top_level()
  shared.warnings.push(...shared.imports.unused_warnings())
}

// A class, struct or type alias cannot have the name of an import; the error points at it.
const reject_types_named_like_imports = (program: Program, imports: Imports): void => {
  for (const statement of program) {
    if (statement.kind !== 'type_declaration' && statement.kind !== 'type_alias') continue
    const { name } = statement
    if (imports.has(name.name)) {
      throw new CompileError(`'${name.name}' is already defined`, name.line, name.column)
    }
  }
}

const exports_of_module = (
  module: Module,
  functions: Functions,
  objects: ObjectTypes,
  resolver: TypeResolver,
  types: Types,
): Map<string, Export> => {
  const exports = new Map<string, Export>()
  for (const statement of module.program) {
    if (!('exported' in statement && statement.exported)) continue
    const { name } = statement
    if (statement.kind === 'declaration' && statement.value.kind === 'function') {
      const type = functions.type_of(name.name, name)!
      const symbol = function_symbol(module.index, name.name)
      exports.set(name.name, { kind: 'lerta_function', type, symbol })
    } else if (statement.kind === 'declaration') {
      const type = types.get(name)!
      const pointer = top_level_symbol(module.index, name.name)
      exports.set(name.name, { kind: 'lerta_value', type, pointer })
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
  // The conversions of the results are recorded even if the type was known from its annotation.
  const type = finish_function_type(context, literal, params, shared.conversions)
  entry.type ??= type
  shared.types.set(literal, entry.type)
}

const check_object = (shared: Shared, info: ObjectInfo): void => {
  const self: SelfContext = { info, initializing: undefined }
  new StatementChecker(shared, undefined, self).check_initializers()
}
