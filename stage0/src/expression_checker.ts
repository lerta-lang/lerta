import {
  is_arithmetic,
  type ArrayLiteral,
  type Binary,
  type Call,
  type Case,
  type Expression,
  type Identifier,
  type Index,
  type Member,
  type Unary,
} from './ast.ts'
import { builtin_method, builtin_property, builtins } from './builtins.ts'
import type { Types } from './checker.ts'
import { CompileError } from './errors.ts'
import type { Functions } from './functions.ts'
import type { Scopes } from './scopes.ts'
import {
  array_type,
  bool_type,
  format_type,
  int_type,
  is_assignable,
  same_type,
  string_type,
  stringable_type,
  uint8_type,
  type Type,
} from './types.ts'

export type CheckerLocal = {
  identifier: Identifier
  type: Type
  mutable: boolean
  // Declared with `const` or `var`, as opposed to a loop variable.
  declared: boolean
  used: boolean
}

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

const numeric_kinds = ['Int', 'UInt8']

// Lists kinds for a message, such as "Int or UInt8".
const describe_kinds = (kinds: string[]): string =>
  kinds.length === 1 ? kinds[0] : `${kinds.slice(0, -1).join(', ')} or ${kinds.at(-1)}`

// Computes the types of expressions and records them. An expected type, where one is known, is
// passed down so that it can give literals their type.
export class ExpressionChecker {
  private readonly types: Types
  private readonly scopes: Scopes<CheckerLocal>
  private readonly functions: Functions

  constructor(types: Types, scopes: Scopes<CheckerLocal>, functions: Functions) {
    this.types = types
    this.scopes = scopes
    this.functions = functions
  }

  type_of(expression: Expression, expected?: Type): Type {
    return this.record(expression, this.compute_type(expression, expected))
  }

  // `expected` is a hint: the caller still checks that the type fits.
  private compute_type(expression: Expression, expected: Type | undefined): Type {
    const wants_byte = expected?.kind === 'UInt8'
    switch (expression.kind) {
      case 'string':
        return wants_byte ? this.byte_literal(expression) : string_type
      case 'interpolation':
        for (const part of expression.parts) {
          if (typeof part !== 'string') this.expect_type(part, stringable_type)
        }
        return string_type
      case 'integer':
        return wants_byte ? this.byte_literal(expression) : int_type
      case 'boolean':
        return bool_type
      case 'identifier':
        return this.type_of_identifier(expression)
      case 'call':
        return this.type_of_call(expression)
      case 'unary':
        return this.type_of_unary(expression, expected)
      case 'binary':
        return this.type_of_binary(expression, expected)
      case 'case':
        return this.type_of_case(expression, expected)
      case 'member':
        return this.type_of_property(expression)
      case 'array':
        return this.type_of_array(expression, expected)
      case 'index':
        return this.type_of_index(expression)
      case 'function': {
        const message = 'a function can only be the value of a top-level const so far'
        throw new CompileError(message, expression.line, expression.column)
      }
      case 'range':
        throw new CompileError(
          "a range can only be used after 'in' of a 'for'",
          expression.line,
          expression.column,
        )
    }
  }

  private type_of_identifier(identifier: Identifier): Type {
    const local = this.scopes.lookup(identifier.name)
    if (local !== undefined) {
      local.used = true
      return local.type
    }
    const function_type = this.functions.type_of(identifier.name, identifier)
    if (function_type !== undefined) return function_type
    const builtin = builtins.get(identifier.name)
    if (builtin === undefined) {
      const message = `undefined name '${identifier.name}'`
      throw new CompileError(message, identifier.line, identifier.column)
    }
    return builtin.type
  }

  private type_of_call(call: Call): Type {
    const { callee } = call
    const callee_type =
      callee.kind === 'member' ? this.type_of_method(callee) : this.type_of(callee)
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

  private type_of_method(member: Member): Type {
    const object_type = this.type_of(member.object)
    const { name, line, column } = member.name
    const method = builtin_method(object_type, name)
    if (method === undefined) {
      throw new CompileError(
        `type ${format_type(object_type)} has no method '${name}'`,
        line,
        column,
      )
    }
    this.types.set(member, method)
    return method
  }

  // A member that is not called is a property such as `length`.
  private type_of_property(member: Member): Type {
    const object_type = this.type_of(member.object)
    const { name, line, column } = member.name
    const property = builtin_property(object_type, name)
    if (property !== undefined) return property
    if (builtin_method(object_type, name) !== undefined) {
      throw new CompileError(`a method must be called: write \`${name}()\``, line, column)
    }
    const message = `type ${format_type(object_type)} has no property '${name}'`
    throw new CompileError(message, line, column)
  }

  // The element type comes from the expected type if there is one, so that `[[], [1]]` can be
  // typed; otherwise from the first element whose type does not come from the context, so that
  // `[1, c]` holds UInt8s when `c` is one.
  private type_of_array(array: ArrayLiteral, expected: Type | undefined): Type {
    if (expected?.kind === 'Array') {
      for (const item of array.elements) this.expect_type(item, expected.element)
      return expected
    }
    const anchor = array.elements.find((item) => !is_contextual(item)) ?? array.elements[0]
    if (anchor === undefined) {
      const message =
        'the type of an empty array must be written, as in `const xs: Array<Int> = []`'
      throw new CompileError(message, array.line, array.column)
    }
    const element = this.type_of(anchor)
    if (element.kind === 'void' || element.kind === 'function') {
      const message = `an array cannot hold values of type ${format_type(element)}`
      throw new CompileError(message, anchor.line, anchor.column)
    }
    for (const item of array.elements) {
      if (item !== anchor) this.expect_type(item, element)
    }
    return array_type(element)
  }

  private type_of_index(index: Index): Type {
    const object_type = this.type_of(index.object)
    if (object_type.kind !== 'Array' && object_type.kind !== 'Binary') {
      const message = `cannot index a value of type ${format_type(object_type)}`
      throw new CompileError(message, index.object.line, index.object.column)
    }
    this.expect_type(index.index, int_type)
    return object_type.kind === 'Array' ? object_type.element : uint8_type
  }

  private type_of_unary(unary: Unary, expected: Type | undefined): Type {
    if (unary.operator === 'not') {
      this.expect_type(unary.operand, bool_type)
      return bool_type
    }
    const hint =
      expected !== undefined && numeric_kinds.includes(expected.kind) ? expected : undefined
    const type = this.type_of(unary.operand, hint)
    if (!numeric_kinds.includes(type.kind)) {
      const message = `expected ${describe_kinds(numeric_kinds)}, got ${format_type(type)}`
      throw new CompileError(message, unary.operand.line, unary.operand.column)
    }
    return type
  }

  // Arithmetic passes the expected type to its operands; a comparison's operands have their own.
  private type_of_binary(binary: Binary, expected: Type | undefined): Type {
    const { operator } = binary
    if (operator === 'and' || operator === 'or') {
      this.expect_type(binary.left, bool_type)
      this.expect_type(binary.right, bool_type)
      return bool_type
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
    const type = this.type_of(first, expected)
    if (!allowed_kinds.includes(type.kind)) {
      throw new CompileError(reject(type), first.line, first.column)
    }
    this.expect_type(second, type)
    return type
  }

  // Every arm must have the type of the first one.
  // With an expected type, every arm is checked against it, which can type `[]` and literals;
  // otherwise every arm must have the type of the first one.
  private type_of_case(case_expression: Case, expected: Type | undefined): Type {
    for (const arm of case_expression.arms) this.expect_type(arm.condition, bool_type)
    const values = [...case_expression.arms.map((arm) => arm.value), case_expression.otherwise]
    if (expected !== undefined) {
      for (const value of values) this.expect_type(value, expected)
      return expected
    }
    const [first, ...rest] = values
    const type = this.type_of(first)
    for (const value of rest) {
      const value_type = this.type_of(value)
      if (!same_type(value_type, type)) {
        const types = `expected ${format_type(type)}, got ${format_type(value_type)}`
        const message = `case arms must have the same type: ${types}`
        throw new CompileError(message, value.line, value.column)
      }
    }
    return type
  }

  // Stringable is a set of types, not one a value can be given, so it is no hint.
  expect_type(expression: Expression, expected: Type): void {
    const hint = expected.kind === 'Stringable' ? undefined : expected
    this.require_type(expression, this.type_of(expression, hint), expected)
  }

  // An integer from 0 to 255, or a string of one byte, can be a UInt8.
  private byte_literal(literal: Expression): Type {
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

  private record(expression: Expression, type: Type): Type {
    this.types.set(expression, type)
    return type
  }

  private require_type(expression: Expression, type: Type, expected: Type): void {
    if (!is_assignable(type, expected)) {
      const message = `expected ${format_type(expected)}, got ${format_type(type)}`
      throw new CompileError(message, expression.line, expression.column)
    }
  }
}
