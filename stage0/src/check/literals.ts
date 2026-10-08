// Facts about literals: which expressions take their type from the context, and literals as UInt8s.
import { is_arithmetic, type Expression } from '../syntax/ast.ts'
import { CompileError } from '../errors.ts'
import { uint8_type, type Type } from '../types.ts'

// Whether an expression takes its type from the context: a literal, or arithmetic on such
// expressions, so that `1 + 2` is a UInt8 where one is expected.
export const is_contextual = (expression: Expression): boolean => {
  switch (expression.kind) {
    case 'integer':
    case 'string':
      return true
    case 'unary':
      return expression.operator === '-' && is_contextual(expression.operand)
    case 'binary':
      return (
        is_arithmetic(expression.operator) &&
        is_contextual(expression.left) &&
        is_contextual(expression.right)
      )
    default:
      return false
  }
}

// An integer from 0 to 255, or a string of one byte, can be a UInt8.
export const byte_literal = (literal: Expression): Type => {
  const fits =
    literal.kind === 'integer'
      ? literal.value >= 0n && literal.value <= 255n
      : literal.kind === 'string' && new TextEncoder().encode(literal.value).length === 1
  if (!fits) {
    const message =
      literal.kind === 'integer'
        ? 'integer literal does not fit in UInt8'
        : 'a string literal used as a UInt8 must be one byte long'
    throw new CompileError(message, literal.line, literal.column)
  }
  return uint8_type
}
