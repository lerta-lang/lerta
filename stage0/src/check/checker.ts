// Checks a program: the types of its expressions, its conversions and its warnings.
import {
  type Declaration,
  type Expression,
  type NamedType,
  type FunctionLiteral,
  type Identifier,
  type Import,
  type Program,
  type Statement,
  type TypeDeclaration,
} from '../syntax/ast.ts'
import { CompileError, CompileWarning } from '../errors.ts'
import { Functions, method_key, parameter_types, type FunctionEntry } from './functions.ts'
import { Imports, type Export } from './imports.ts'
import { with_module_path, type Module } from '../loader.ts'
import { ObjectTypes, type FieldInfo, type ObjectInfo } from './object_types.ts'
import { finish_function_type } from './result_checker.ts'
import { StatementChecker } from './statement_checker.ts'
import { reject_misplaced_jumps } from './jump_positions.ts'
import { TopLevelValues } from './top_level_values.ts'
import { TypeResolver } from './type_names.ts'
import { format_type, is_reference_type, type Type } from '../types.ts'

// The type of every expression in a checked program, and the type that the name of `x is T`
// stands for.
export type Types = Map<Expression | NamedType, Type>
// The type an expression is converted to where it is used, such as an Int passed as an Int?.
export type Conversions = Map<Expression, Type>
// What each function literal that is not a top-level function captures from around it: the names
// and the types they have there, which may be narrowed.
export type Capture = { name: string; type: Type; is_var: boolean }
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
  extern_types: Map<string, Type>
  // The `var`s that function literals capture, by their declarations' names.
  shared_vars: Set<Identifier>
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
  shared_vars: Set<Identifier>
  // What the module exports, for the modules that import it.
  exports: Map<string, Export>
}

// What the modules share: the classes and structs of every module checked so far, by symbol, and
// the type each C function was first declared with by an extern.
type ProgramWide = { infos: Map<string, ObjectInfo>; extern_types: Map<string, Type> }

// Checks the modules in order, each after those it imports (see load_modules). The warnings of
// all the modules come back with the last one's, or with the error.
export const check_modules = (modules: Module[]): Checked[] => {
  const checked: Checked[] = []
  const warnings: CompileWarning[] = []
  const program_wide: ProgramWide = { infos: new Map(), extern_types: new Map() }
  try {
    for (const module of modules) {
      const exports_of = (statement: Import) =>
        checked[module.imported.get(statement)!.index].exports
      const result = with_module_path(module.display_path, () =>
        check(module, exports_of, program_wide),
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
  exports_of: (statement: Import) => Map<string, Export>,
  program_wide: ProgramWide,
): Checked => {
  const { program } = module
  const shared = create_shared(module, exports_of, program_wide)
  const { types, conversions, warnings, functions, objects, resolver, imports, captures } = shared
  try {
    reject_misplaced_jumps(program)
    declare_names(program, shared)
    check_code(program, shared)
  } catch (error) {
    if (error instanceof CompileError) error.warnings = in_source_order(warnings)
    throw error
  }
  const exports = exports_of_module(module, functions, objects, resolver, types, shared.imports)
  return {
    types,
    conversions,
    objects,
    imports,
    warnings: in_source_order(warnings),
    captures,
    shared_vars: shared.shared_vars,
    exports,
  }
}

const create_shared = (
  module: Module,
  exports_of: (statement: Import) => Map<string, Export>,
  program_wide: ProgramWide,
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
    program_wide.infos,
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
    extern_types: program_wide.extern_types,
    shared_vars: new Set(),
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
  resolver.resolve_aliases()
  declare_externs(program, shared)
  reject_types_named_like_imports(program, imports)
  add_top_level_functions(program, functions, objects, resolver, imports)
  objects.add_members(resolver, functions)
}

// An extern's type is a function type, which gives the C function's parameters and result. A C
// function has one C type, so all the externs of a symbol in the program must agree on it; a String
// and a Binary, both pointers, can stand for the same parameter.
const declare_externs = (program: Program, { resolver, imports, extern_types }: Shared): void => {
  for (const statement of program) {
    if (statement.kind !== 'extern') continue
    const type = resolver.resolve(statement.type, true)
    if (type.kind !== 'function') {
      const { line, column } = statement.type
      throw new CompileError('an extern is a C function, of a function type', line, column)
    }
    const { symbol } = statement
    const declared = extern_types.get(symbol.name)
    if (declared !== undefined && c_signature(declared) !== c_signature(type)) {
      const message = `the C function '${symbol.name}' is declared as ${format_type(declared)} elsewhere`
      throw new CompileError(message, symbol.line, symbol.column)
    }
    extern_types.set(symbol.name, type)
    imports.add_extern(statement.name, type, symbol.name)
  }
}

// The C type that a value of the type is passed as: a reference is a pointer, and an optional Int,
// UInt8 or Bool a pair of a flag and the value (see codegen/lerta_ir.ts).
const c_type = (type: Type): string => {
  if (is_reference_type(type)) return 'pointer'
  return type.kind === 'Optional' ? `${c_type(type.inner)}?` : type.kind
}

const c_signature = (type: Type): string => {
  if (type.kind !== 'function') throw new Error('an extern has a function type')
  return `(${type.params.map(c_type).join(', ')}) -> ${c_type(type.result)}`
}

// The top-level code, then the objects and functions, which may use its names.
const check_code = (program: Program, shared: Shared): void => {
  const warn_unused_top_level = new StatementChecker(shared, undefined, undefined).check_top_level(
    program,
  )
  shared.objects.check_all()
  shared.functions.check_all()
  reject_deinit_results(shared)
  warn_unused_top_level()
  shared.warnings.push(...shared.imports.unused_warnings())
}

// A deinit runs as part of a release, where nothing could take a value it gave, or handle a throw.
const reject_deinit_results = ({ objects, functions }: Shared): void => {
  for (const info of objects.all()) {
    const literal = info.methods.get('deinit')
    if (literal === undefined) continue
    const key = method_key(info.declaration.name.name, 'deinit')
    const type = functions.type_of(key, literal)
    const result = type?.kind === 'function' ? type.result : undefined
    if (result?.kind === 'never') {
      throw new CompileError('deinit cannot throw', literal.line, literal.column)
    }
    if (result !== undefined && result.kind !== 'void') {
      throw new CompileError('deinit gives no value', literal.line, literal.column)
    }
  }
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
  imports: Imports,
): Map<string, Export> => {
  const exports = new Map<string, Export>()
  for (const statement of module.program) {
    if (!('exported' in statement && statement.exported)) continue
    const { name } = statement
    if (statement.kind === 'declaration' && statement.value.kind === 'function') {
      const type = functions.type_of(name.name, name)!
      exports.set(name.name, {
        kind: 'lerta_function',
        type,
        module_index: module.index,
        name: name.name,
      })
    } else if (statement.kind === 'declaration') {
      const type = types.get(name)!
      exports.set(name.name, {
        kind: 'lerta_value',
        type,
        module_index: module.index,
        name: name.name,
      })
    } else if (statement.kind === 'extern') {
      exports.set(name.name, imports.get(name.name)!.export)
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
