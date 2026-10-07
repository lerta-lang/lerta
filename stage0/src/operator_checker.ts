// Types unary and binary operators, nil tests and `?`.
import { is_arithmetic, is_nil_test, type Binary, type Coalesce, type Unary } from './ast.ts'
import { CompileError } from './errors.ts'
import { is_contextual } from './literals.ts'
import type { ExpressionChecker } from './expression_checker.ts'
import { bool_type, format_type, type Type } from './types.ts'

const numeric_kinds = ['Int', 'UInt8']

// Lists kinds for a message, such as "Int or UInt8".
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
      this.type_of_operands(binary, undefined, ['Int', 'UInt8', 'Bool', 'String'], (type) => {
        return `cannot compare values of type ${format_type(type)}`
      })
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
  // the other one, so that `c == 'a'` and `'a' == c` compare UInt8s when `c` is one.
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
    if (!allowed_kinds.includes(type.kind)) {
      throw new CompileError(reject(type), first.line, first.column)
    }
    this.expressions.expect_type(second, type)
    return type
  }
}
