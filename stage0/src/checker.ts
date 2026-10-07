// Checks a program: the types of its expressions, its conversions and its warnings.
import {
  type Declaration,
  type Expression,
  type FunctionLiteral,
  type Program,
  type Statement,
} from './ast.ts'
import { CompileError, CompileWarning } from './errors.ts'
import { Functions, parameter_types, type FunctionEntry } from './functions.ts'
import { StatementChecker } from './statement_checker.ts'
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
}

// The function whose body is being checked: its written return type, or the one being inferred.
export type FunctionContext = {
  annotated: Type | undefined
  inferred: Type | undefined
  // The returned values, converted to the return type once it is known.
  results: { value: Expression; type: Type }[]
}

export type Checked = { types: Types; conversions: Conversions; warnings: CompileWarning[] }

export const check = (program: Program): Checked => {
  const types: Types = new Map()
  const conversions: Conversions = new Map()
  const warnings: CompileWarning[] = []
  const functions: Functions = new Functions((entry) => check_function(shared, entry))
  const shared: Shared = { types, conversions, warnings, functions }
  try {
    add_top_level_functions(program, functions)
    new StatementChecker(shared, undefined).check_block(program)
    functions.check_all()
  } catch (error) {
    if (error instanceof CompileError) error.warnings = in_source_order(warnings)
    throw error
  }
  return { types, conversions, warnings: in_source_order(warnings) }
}

const is_function_declaration = (statement: Statement): statement is Declaration =>
  statement.kind === 'declaration' && statement.value.kind === 'function'

const add_top_level_functions = (program: Program, functions: Functions): void => {
  for (const statement of program.filter(is_function_declaration)) {
    if (statement.mutable) {
      const message = 'a function must be declared with const'
      throw new CompileError(message, statement.line, statement.column)
    }
    functions.add(statement.name, statement.value as FunctionLiteral)
  }
}

const check_function = (shared: Shared, entry: FunctionEntry): void => {
  const { literal } = entry
  const params = parameter_types(literal)
  const context: FunctionContext = {
    annotated: entry.type?.kind === 'function' ? entry.type.result : undefined,
    inferred: undefined,
    results: [],
  }
  new StatementChecker(shared, context).check_function_body(literal, params)
  const result = context.annotated ?? context.inferred ?? void_type
  if (result.kind === 'nil') {
    const message = 'nil alone does not give the return type; write it, as in `(): String? ->`'
    throw new CompileError(message, literal.line, literal.column)
  }
  for (const { value, type } of context.results) {
    if (!same_type(type, result)) shared.conversions.set(value, result)
  }
  entry.type ??= { kind: 'function', params, result }
  shared.types.set(literal, entry.type)
}
