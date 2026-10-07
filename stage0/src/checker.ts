import type { Call, Expression, Identifier, Program } from './ast.ts'
import { builtins } from './builtins.ts'
import { CompileError } from './errors.ts'
import { format_type, same_type, string_type, type Type } from './types.ts'

export const check = (program: Program): void => {
  for (const statement of program) check_statement(statement)
}

// See the rules for discarded values in docs/design/errors.md.
const check_statement = (statement: Expression): void => {
  const type = type_of(statement)
  if (statement.kind === 'call') return
  if (type.kind === 'function' && statement.kind === 'identifier') {
    const message = `function value is unused; to call it, write \`${statement.name}()\``
    throw new CompileError(message, statement.line, statement.column)
  }
  throw new CompileError('value is unused', statement.line, statement.column)
}

const type_of = (expression: Expression): Type => {
  switch (expression.kind) {
    case 'string':
      return string_type
    case 'identifier':
      return type_of_identifier(expression)
    case 'call':
      return type_of_call(expression)
  }
}

const type_of_identifier = (identifier: Identifier): Type => {
  const builtin = builtins.get(identifier.name)
  if (builtin === undefined) {
    throw new CompileError(
      `undefined name '${identifier.name}'`,
      identifier.line,
      identifier.column,
    )
  }
  return builtin.type
}

const type_of_call = (call: Call): Type => {
  const callee_type = type_of(call.callee)
  if (callee_type.kind !== 'function') {
    throw new CompileError(
      `cannot call a value of type ${format_type(callee_type)}`,
      call.line,
      call.column,
    )
  }
  const { params } = callee_type
  if (call.args.length !== params.length) {
    const message = `expected ${params.length} argument(s), got ${call.args.length}`
    throw new CompileError(message, call.line, call.column)
  }
  call.args.forEach((arg, i) => {
    const arg_type = type_of(arg)
    if (!same_type(arg_type, params[i])) {
      const message = `expected ${format_type(params[i])}, got ${format_type(arg_type)}`
      throw new CompileError(message, arg.line, arg.column)
    }
  })
  return callee_type.result
}
