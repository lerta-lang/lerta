import {
  is_arithmetic,
  type Binary,
  type Call,
  type Case,
  type Expression,
  type Identifier,
  type Member,
  type Unary,
} from './ast.ts'
import { builtin_methods, builtins } from './builtins.ts'
import type { Types } from './checker.ts'
import { CompileError } from './errors.ts'
import type { Scopes } from './scopes.ts'
import {
  bool_type,
  format_type,
  int_type,
  is_assignable,
  same_type,
  string_type,
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

  constructor(types: Types, scopes: Scopes<CheckerLocal>) {
    this.types = types
    this.scopes = scopes
  }

  type_of(expression: Expression): Type {
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
        return this.type_of_case(expression)
      case 'member': {
        const message = `a method must be called: write \`${expression.name.name}()\``
        throw new CompileError(message, expression.name.line, expression.name.column)
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
    const method = builtin_methods[object_type.kind]?.get(name)
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
    this.expect_type(binary.left, int_type)
    this.expect_type(binary.right, int_type)
    return is_arithmetic(binary.operator) ? int_type : bool_type
  }

  // `==` and `!=` compare two Ints or two Bools.
  private type_of_equality(binary: Binary): Type {
    const left_type = this.type_of(binary.left)
    if (left_type.kind !== 'Int' && left_type.kind !== 'Bool') {
      const message = `cannot compare values of type ${format_type(left_type)}`
      throw new CompileError(message, binary.left.line, binary.left.column)
    }
    this.expect_type(binary.right, left_type)
    return bool_type
  }

  // Every arm must have the type of the first one.
  private type_of_case(case_expression: Case): Type {
    for (const arm of case_expression.arms) this.expect_type(arm.condition, bool_type)
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

  expect_type(expression: Expression, expected: Type): void {
    const type = this.type_of(expression)
    if (!is_assignable(type, expected)) {
      const message = `expected ${format_type(expected)}, got ${format_type(type)}`
      throw new CompileError(message, expression.line, expression.column)
    }
  }
}
