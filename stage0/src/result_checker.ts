// Checks how a function gives its result: its last statement and its `return`s.
import {
  is_expression,
  type Expression,
  type FunctionLiteral,
  type Position,
  type Return,
  type Statement,
} from './ast.ts'
import type { Conversions, FunctionContext } from './checker.ts'
import { CompileError } from './errors.ts'
import type { ExpressionChecker } from './expression_checker.ts'
import type { StatementChecker } from './statement_checker.ts'
import { format_type, is_assignable, same_type, unify, void_type, type Type } from './types.ts'

export class ResultChecker {
  private readonly statements: StatementChecker
  private readonly expressions: ExpressionChecker
  private readonly context: FunctionContext | undefined

  constructor(
    statements: StatementChecker,
    expressions: ExpressionChecker,
    context: FunctionContext | undefined,
  ) {
    this.statements = statements
    this.expressions = expressions
    this.context = context
  }

  // A function with a result must end with its value or a `return`. This is decided by the last
  // statement alone, not by whether the end can be reached.
  check_last_statement(statement: Statement): void {
    const context = this.context!
    let gives_value = false
    const expects_value = context.annotated !== undefined && context.annotated.kind !== 'void'
    if (is_expression(statement) && expects_value) {
      this.record_result(this.type_of_result(statement), statement)
      gives_value = true
    } else if (is_expression(statement)) {
      const type = this.expressions.type_of(statement)
      gives_value = type.kind !== 'void' && context.annotated?.kind !== 'void'
      if (gives_value) this.record_result(type, statement)
      else this.statements.check_discarded(statement, type)
    } else {
      this.statements.check_statement(statement)
    }
    const result = context.annotated ?? context.inferred ?? void_type
    if (result.kind !== 'void' && !gives_value && statement.kind !== 'return') {
      const message = `the function must end with its return value of type ${format_type(result)} or a return`
      throw new CompileError(message, statement.line, statement.column)
    }
  }

  // A return value must fit the written return type. Without one, the values decide it: a mix of
  // T, T? and nil gives T?. Values are converted to the return type when the function is done.
  private record_result(type: Type, at: Expression | Return): void {
    const context = this.context!
    if (at.kind !== 'return') context.results.push({ value: at, type })
    if (context.annotated !== undefined) {
      if (is_assignable(type, context.annotated)) return
      this.reject_result(context.annotated, type, at)
    }
    if (context.inferred === undefined) {
      context.inferred = type
      return
    }
    const unified = unify(context.inferred, type)
    if (unified === undefined) this.reject_result(context.inferred, type, at)
    context.inferred = unified
  }

  private reject_result(expected: Type, type: Type, at: Position): never {
    const message = `expected a return value of type ${format_type(expected)}, got ${format_type(type)}`
    throw new CompileError(message, at.line, at.column)
  }

  check_return(return_statement: Return): void {
    if (this.context === undefined) {
      const message = "'return' outside a function"
      throw new CompileError(message, return_statement.line, return_statement.column)
    }
    const { value } = return_statement
    const type = value === undefined ? void_type : this.type_of_result(value)
    this.record_result(type, value ?? return_statement)
  }

  // A written return type is a hint for the value's type, which can type `[]` and literals; the
  // value is then checked as a return value, for a message that says so.
  private type_of_result(value: Expression): Type {
    const annotated = this.context!.annotated
    const hint = annotated?.kind === 'void' ? undefined : annotated
    return this.expressions.type_of(value, hint)
  }
}

// The type of a function once its body is checked: its return type is the written one, or the one
// its results give, to which they are converted.
export const finish_function_type = (
  context: FunctionContext,
  literal: FunctionLiteral,
  params: Type[],
  conversions: Conversions,
): Type => {
  const result = context.annotated ?? context.inferred ?? void_type
  if (result.kind === 'nil') {
    const message = 'nil alone does not give the return type; write it, as in `(): String? ->`'
    throw new CompileError(message, literal.line, literal.column)
  }
  for (const { value, type } of context.results) {
    if (type.kind !== 'never' && !same_type(type, result)) conversions.set(value, result)
  }
  return { kind: 'function', params, result }
}
