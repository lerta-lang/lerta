import type { Binary, Call, Expression, Identifier, Program, Unary } from './ast.ts'
import { builtins } from './builtins.ts'
import { CompileError } from './errors.ts'
import { format_type, int_type, is_assignable, string_type, type Type } from './types.ts'

// The type of every expression in a checked program.
export type Types = Map<Expression, Type>

export const check = (program: Program): Types => {
  const types: Types = new Map()
  const checker = new Checker(types)
  for (const statement of program) checker.check_statement(statement)
  return types
}

class Checker {
  private readonly types: Types

  constructor(types: Types) {
    this.types = types
  }

  // See the rules for discarded values in docs/reference/errors.md.
  check_statement(statement: Expression): void {
    const type = this.type_of(statement)
    if (statement.kind === 'call') return
    if (type.kind === 'function' && statement.kind === 'identifier') {
      const message = `function value is unused; to call it, write \`${statement.name}()\``
      throw new CompileError(message, statement.line, statement.column)
    }
    throw new CompileError('value is unused', statement.line, statement.column)
  }

  private type_of(expression: Expression): Type {
    const type = this.compute_type(expression)
    this.types.set(expression, type)
    return type
  }

  private compute_type(expression: Expression): Type {
    switch (expression.kind) {
      case 'string':
        return string_type
      case 'integer':
        return int_type
      case 'identifier':
        return this.type_of_identifier(expression)
      case 'call':
        return this.type_of_call(expression)
      case 'unary':
        return this.type_of_unary(expression)
      case 'binary':
        return this.type_of_binary(expression)
    }
  }

  private type_of_identifier(identifier: Identifier): Type {
    const builtin = builtins.get(identifier.name)
    if (builtin === undefined) {
      const message = `undefined name '${identifier.name}'`
      throw new CompileError(message, identifier.line, identifier.column)
    }
    return builtin.type
  }

  private type_of_call(call: Call): Type {
    const callee_type = this.type_of(call.callee)
    if (callee_type.kind !== 'function') {
      const message = `cannot call a value of type ${format_type(callee_type)}`
      throw new CompileError(message, call.line, call.column)
    }
    const { params } = callee_type
    if (call.args.length !== params.length) {
      const message = `expected ${params.length} argument(s), got ${call.args.length}`
      throw new CompileError(message, call.line, call.column)
    }
    call.args.forEach((arg, i) => this.expect_type(arg, params[i]))
    return callee_type.result
  }

  private type_of_unary(unary: Unary): Type {
    this.expect_type(unary.operand, int_type)
    return int_type
  }

  private type_of_binary(binary: Binary): Type {
    this.expect_type(binary.left, int_type)
    this.expect_type(binary.right, int_type)
    return int_type
  }

  private expect_type(expression: Expression, expected: Type): void {
    const type = this.type_of(expression)
    if (!is_assignable(type, expected)) {
      const message = `expected ${format_type(expected)}, got ${format_type(type)}`
      throw new CompileError(message, expression.line, expression.column)
    }
  }
}
