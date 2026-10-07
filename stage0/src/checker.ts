// Checks a program: the types of its expressions, its conversions and its warnings.
import {
  type Declaration,
  type Expression,
  type FunctionLiteral,
  type Program,
  type Statement,
  type TypeDeclaration,
} from './ast.ts'
import { CompileError, CompileWarning } from './errors.ts'
import { Functions, parameter_types, type FunctionEntry } from './functions.ts'
import { Imports } from './imports.ts'
import { ObjectTypes, type FieldInfo, type ObjectInfo } from './object_types.ts'
import { StatementChecker } from './statement_checker.ts'
import { TypeResolver } from './type_names.ts'
import { same_type, void_type, type Type } from './types.ts'

// The type of every expression in a checked program.
export type Types = Map<Expression, Type>
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
}

export const check = (program: Program): Checked => {
  const types: Types = new Map()
  const conversions: Conversions = new Map()
  const warnings: CompileWarning[] = []
  const objects: ObjectTypes = new ObjectTypes((info) => check_object(shared, info))
  const resolver = new TypeResolver((name) => objects.object_type(name))
  const functions: Functions = new Functions((entry) => check_function(shared, entry), resolver)
  const imports = new Imports()
  const shared: Shared = { types, conversions, warnings, functions, objects, resolver, imports }
  try {
    objects.add(
      program.filter(
        (statement): statement is TypeDeclaration => statement.kind === 'type_declaration',
      ),
    )
    add_top_level_functions(program, functions, objects)
    imports.add(program, (name) => functions.has(name) || objects.object_type(name) !== undefined)
    objects.add_members(resolver, functions)
    new StatementChecker(shared, undefined, undefined).check_block(program)
    objects.check_all()
    functions.check_all()
    warnings.push(...imports.unused_warnings())
  } catch (error) {
    if (error instanceof CompileError) error.warnings = in_source_order(warnings)
    throw error
  }
  return { types, conversions, objects, imports, warnings: in_source_order(warnings) }
}

const is_function_declaration = (statement: Statement): statement is Declaration =>
  statement.kind === 'declaration' && statement.value.kind === 'function'

const add_top_level_functions = (
  program: Program,
  functions: Functions,
  objects: ObjectTypes,
): void => {
  for (const statement of program.filter(is_function_declaration)) {
    if (statement.mutable) {
      const message = 'a function must be declared with const'
      throw new CompileError(message, statement.line, statement.column)
    }
    const { name } = statement
    if (objects.object_type(name.name) !== undefined) {
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
