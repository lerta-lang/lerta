// Types unary and binary operators, nil tests and `?`.
import {
  is_arithmetic,
  is_nil_test,
  type Binary,
  type Coalesce,
  type Unary,
} from '../syntax/ast.ts'
import { CompileError } from '../errors.ts'
import { is_contextual } from './literals.ts'
import type { ExpressionChecker } from './expression_checker.ts'
import { bool_type, format_type, is_identity_type, same_type, type Type } from '../types.ts'

const numeric_kinds = ['Int', 'Byte']

const classes_of = (type: Type): Type[] => (type.kind === 'Union' ? type.members : [type])

const share_a_class = (a: Type, b: Type): boolean =>
  classes_of(a).some((member) => classes_of(b).some((other) => same_type(member, other)))

// Lists kinds for a message, such as "Int or Byte".
const describe_kinds = (kinds: string[]): string =>
  kinds.length === 1 ? kinds[0] : `${kinds.slice(0, -1).join(', ')} or ${kinds.at(-1)}`

export class OperatorChecker {
  private readonly expressions: ExpressionChecker

  constructor(expressions: ExpressionChecker) {
    this.expressions = expressions
  }

  type_of_unary(unary: Unary, expected: Type | undefined): Type {
    if (unary.operator === 'not') {
      this.expressions.expect_condition(unary.operand)
      return bool_type
    }
    const hint =
      expected !== undefined && numeric_kinds.includes(expected.kind) ? expected : undefined
    const type = this.expressions.type_of(unary.operand, hint)
    if (!numeric_kinds.includes(type.kind)) {
      const message = `expected ${describe_kinds(numeric_kinds)}, got ${format_type(type)}`
      throw new CompileError(message, unary.operand.line, unary.operand.column)
    }
    return type
  }

  // `x == nil` and `x != nil` test an optional value.
  private type_of_nil_test(binary: Binary): Type {
    const [nil, value] =
      binary.left.kind === 'nil' ? [binary.left, binary.right] : [binary.right, binary.left]
    this.expressions.type_of(nil)
    this.expressions.expect_optional(value)
    return bool_type
  }

  // `x ? fallback` is x without nil; the fallback has that type too.
  type_of_coalesce(coalesce: Coalesce): Type {
    const inner = this.expressions.expect_optional(coalesce.value)
    this.expressions.expect_type(coalesce.fallback, inner)
    return inner
  }

  // Arithmetic passes the expected type to its operands; a comparison's operands have their own.
  type_of_binary(binary: Binary, expected: Type | undefined): Type {
    const { operator } = binary
    if (operator === 'and' || operator === 'or') {
      this.expressions.expect_condition(binary.left)
      this.expressions.expect_condition(binary.right)
      return bool_type
    }
    if (is_nil_test(binary)) {
      return this.type_of_nil_test(binary)
    }
    if (operator === '==' || operator === '!=') {
      this.type_of_operands(
        binary,
        undefined,
        ['Int', 'Byte', 'Bool', 'String', 'Binary'],
        (type) => `cannot compare values of type ${format_type(type)}`,
      )
      return bool_type
    }
    const allowed = operator === '+' ? [...numeric_kinds, 'String'] : numeric_kinds
    const reject = (type: Type) => `expected ${describe_kinds(allowed)}, got ${format_type(type)}`
    if (!is_arithmetic(operator)) {
      this.type_of_operands(binary, undefined, numeric_kinds, reject)
      return bool_type
    }
    const hint = expected !== undefined && allowed.includes(expected.kind) ? expected : undefined
    return this.type_of_operands(binary, hint, allowed, reject)
  }

  // The type both operands share. An operand whose type comes from the context is checked against
  // the other one, so that `c == 'a'` and `'a' == c` compare Bytes when `c` is one.
  private type_of_operands(
    binary: Binary,
    expected: Type | undefined,
    allowed_kinds: string[],
    reject: (type: Type) => string,
  ): Type {
    const { left, right } = binary
    const right_first = is_contextual(left) && !is_contextual(right)
    const [first, second] = right_first ? [right, left] : [left, right]
    const type = this.expressions.type_of(first, expected)
    if (binary.operator === '==' || binary.operator === '!=') {
      if (is_identity_type(type)) return this.type_of_identity_operand(second, type)
    }
    if (!allowed_kinds.includes(type.kind)) {
      throw new CompileError(reject(type), first.line, first.column)
    }
    this.expressions.expect_type(second, type)
    return type
  }

  // Objects compared by identity may be of different types, as a class and a union that holds it,
  // as long as both can hold an object of the same class.
  private type_of_identity_operand(second: Binary['right'], first_type: Type): Type {
    const type = this.expressions.type_of(second, undefined)
    const may_be_same = is_identity_type(type) && share_a_class(first_type, type)
    if (!may_be_same) {
      const message = `cannot compare ${format_type(first_type)} with ${format_type(type)}`
      throw new CompileError(message, second.line, second.column)
    }
    return first_type
  }
}
