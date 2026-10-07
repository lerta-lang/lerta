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

// Computes the types of expressions and records them.
export class ExpressionChecker {
  private readonly types: Types
  private readonly scopes: Scopes<CheckerLocal>
  private readonly functions: Functions

  constructor(types: Types, scopes: Scopes<CheckerLocal>, functions: Functions) {
    this.types = types
    this.scopes = scopes
    this.functions = functions
  }

  type_of(expression: Expression): Type {
    return this.record(expression, this.compute_type(expression))
  }

  private compute_type(expression: Expression): Type {
    switch (expression.kind) {
      case 'string':
        return string_type
      case 'interpolation':
        for (const part of expression.parts) {
          if (typeof part !== 'string') this.expect_type(part, stringable_type)
        }
        return string_type
      case 'integer':
        return int_type
      case 'boolean':
        return bool_type
      case 'identifier':
        return this.type_of_identifier(expression)
      case 'call':
        return this.type_of_call(expression)
      case 'unary':
        return this.type_of_unary(expression)
      case 'binary':
        return this.type_of_binary(expression)
      case 'case':
        return this.type_of_case(expression, undefined)
      case 'member':
        return this.type_of_property(expression)
      case 'array':
        return this.type_of_array(expression, undefined)
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
  // typed; otherwise from the first element.
  private type_of_array(array: ArrayLiteral, expected: Type | undefined): Type {
    if (expected?.kind === 'Array') {
      for (const item of array.elements) this.expect_type(item, expected.element)
      return expected
    }
    const [first, ...rest] = array.elements
    if (first === undefined) {
      const message =
        'the type of an empty array must be written, as in `const xs: Array<Int> = []`'
      throw new CompileError(message, array.line, array.column)
    }
    const element = this.type_of(first)
    if (element.kind === 'void' || element.kind === 'function') {
      const message = `an array cannot hold values of type ${format_type(element)}`
      throw new CompileError(message, first.line, first.column)
    }
    for (const item of rest) this.expect_type(item, element)
    return array_type(element)
  }

  private type_of_index(index: Index): Type {
    const object_type = this.type_of(index.object)
    if (object_type.kind !== 'Array') {
      const message = `cannot index a value of type ${format_type(object_type)}`
      throw new CompileError(message, index.object.line, index.object.column)
    }
    this.expect_type(index.index, int_type)
    return object_type.element
  }

  private type_of_unary(unary: Unary): Type {
    const type = unary.operator === 'not' ? bool_type : int_type
    this.expect_type(unary.operand, type)
    return type
  }

  private type_of_binary(binary: Binary): Type {
    if (binary.operator === '==' || binary.operator === '!=') return this.type_of_equality(binary)
    if (binary.operator === 'and' || binary.operator === 'or') {
      this.expect_type(binary.left, bool_type)
      this.expect_type(binary.right, bool_type)
      return bool_type
    }
    const left_type = this.type_of(binary.left)
    if (binary.operator === '+' && left_type.kind === 'String') {
      this.expect_type(binary.right, string_type)
      return string_type
    }
    this.require_type(binary.left, left_type, int_type)
    this.expect_type(binary.right, int_type)
    return is_arithmetic(binary.operator) ? int_type : bool_type
  }

  // `==` and `!=` compare two Ints, Bools or Strings.
  private type_of_equality(binary: Binary): Type {
    const left_type = this.type_of(binary.left)
    if (!['Int', 'Bool', 'String'].includes(left_type.kind)) {
      const message = `cannot compare values of type ${format_type(left_type)}`
      throw new CompileError(message, binary.left.line, binary.left.column)
    }
    this.expect_type(binary.right, left_type)
    return bool_type
  }

  // Every arm must have the type of the first one.
  // With an expected array type, every arm is checked against it, which can type `[]`; otherwise
  // every arm must have the type of the first one. (An expected type such as Stringable is a set
  // of types, which cannot be the type of the `case`.)
  private type_of_case(case_expression: Case, expected: Type | undefined): Type {
    for (const arm of case_expression.arms) this.expect_type(arm.condition, bool_type)
    const values = [...case_expression.arms.map((arm) => arm.value), case_expression.otherwise]
    if (expected?.kind === 'Array') {
      for (const value of values) this.expect_type(value, expected)
      return expected
    }
    const [first, ...rest] = case_expression.arms.map((arm) => arm.value)
    const type = this.type_of(first)
    for (const value of [...rest, case_expression.otherwise]) {
      const value_type = this.type_of(value)
      if (!same_type(value_type, type)) {
        const types = `expected ${format_type(type)}, got ${format_type(value_type)}`
        const message = `case arms must have the same type: ${types}`
        throw new CompileError(message, value.line, value.column)
      }
    }
    return type
  }

  // The expected type also gives `[]` its type, including inside arrays and `case` arms.
  expect_type(expression: Expression, expected: Type): void {
    const type =
      expression.kind === 'array'
        ? this.record(expression, this.type_of_array(expression, expected))
        : expression.kind === 'case'
          ? this.record(expression, this.type_of_case(expression, expected))
          : this.type_of(expression)
    this.require_type(expression, type, expected)
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
