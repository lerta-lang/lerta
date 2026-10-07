// Types expressions; ObjectChecker types classes and structs, OperatorChecker the operators,
// CaseChecker case, and CollectionChecker arrays and maps.
import { type Call, type Expression, type Identifier, type IsTest, type Member } from './ast.ts'
import { builtin_method, builtin_property, builtins } from './builtins.ts'
import type { Conversions, SelfContext, Shared, Types } from './checker.ts'
import { CaseChecker } from './case_checker.ts'
import { CollectionChecker } from './collection_checker.ts'
import { CompileError } from './errors.ts'
import type { Functions } from './functions.ts'
import type { Imports } from './imports.ts'
import type { TopLevelValues } from './top_level_values.ts'
import type { ObjectTypes } from './object_types.ts'
import { byte_literal } from './literals.ts'
import { ObjectChecker } from './object_checker.ts'
import { OperatorChecker } from './operator_checker.ts'
import type { Scopes } from './scopes.ts'
import type { TypeResolver } from './type_names.ts'
import {
  bool_type,
  format_type,
  int_type,
  never_type,
  nil_type,
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
  // For a narrowed view of a local (see Scopes.narrow), the local itself.
  origin?: CheckerLocal
}

// Computes the types of expressions and records them. An expected type, where one is known, is
// passed down so that it can give literals their type.
export class ExpressionChecker {
  private readonly types: Types
  private readonly scopes: Scopes<CheckerLocal>
  private readonly functions: Functions
  private readonly conversions: Conversions
  private readonly object_types: ObjectTypes
  private readonly self: SelfContext | undefined
  private readonly imports: Imports
  private readonly top_level: TopLevelValues | undefined
  private readonly operators = new OperatorChecker(this)
  private readonly objects: ObjectChecker
  private readonly cases: CaseChecker
  private readonly collections: CollectionChecker
  private readonly resolver: TypeResolver

  // `top_level` is given to the checker of a function or a method, which sees the top-level values.
  constructor(
    shared: Shared,
    scopes: Scopes<CheckerLocal>,
    self: SelfContext | undefined,
    top_level: TopLevelValues | undefined,
  ) {
    this.imports = shared.imports
    this.top_level = top_level
    this.types = shared.types
    this.conversions = shared.conversions
    this.functions = shared.functions
    this.object_types = shared.objects
    this.scopes = scopes
    this.self = self
    this.objects = new ObjectChecker(this, shared, scopes, self)
    this.cases = new CaseChecker(this, scopes, shared.objects, shared.conversions, shared.resolver)
    this.resolver = shared.resolver
    this.collections = new CollectionChecker(this, scopes, shared.functions)
  }

  field_target(member: Member): Type {
    return this.objects.field_target(member)
  }

  type_of(expression: Expression, expected?: Type): Type {
    return this.record(expression, this.compute_type(expression, expected))
  }

  // `expected` is a hint: the caller still checks that the type fits.
  private compute_type(expression: Expression, expected: Type | undefined): Type {
    const wants_byte = expected?.kind === 'UInt8'
    switch (expression.kind) {
      case 'string':
        return wants_byte ? byte_literal(expression) : string_type
      case 'interpolation':
        for (const part of expression.parts) {
          if (typeof part !== 'string') this.expect_type(part, stringable_type)
        }
        return string_type
      case 'integer':
        return wants_byte ? byte_literal(expression) : int_type
      case 'nil':
        return nil_type
      case 'throw':
        this.expect_type(expression.message, string_type)
        return never_type
      case 'is':
        return this.type_of_is_test(expression)
      case 'this':
        return this.objects.type_of_this(expression)
      case 'unwrap':
        return this.expect_optional(expression.operand)
      case 'coalesce':
        return this.operators.type_of_coalesce(expression)
      case 'boolean':
        return bool_type
      case 'identifier':
        return this.type_of_identifier(expression)
      case 'call':
        return this.type_of_call(expression, expected)
      case 'unary':
        return this.operators.type_of_unary(expression, expected)
      case 'binary':
        return this.operators.type_of_binary(expression, expected)
      case 'case':
        return this.cases.type_of_case(expression, expected)
      case 'conditional':
        return this.cases.type_of_conditional(expression, expected)
      case 'member':
        return this.type_of_property(expression)
      case 'array':
        return this.collections.type_of_array(expression, expected)
      case 'map':
        return this.collections.type_of_map(expression, expected)
      case 'index':
        return this.collections.type_of_index(expression)
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
      ;(local.origin ?? local).used = true
      return local.type
    }
    const function_type = this.functions.type_of(identifier.name, identifier)
    if (function_type !== undefined) return function_type
    if (this.object_types.object_type(identifier.name) !== undefined) {
      const message = `'${identifier.name}' is a type; construct it as ${identifier.name}(...)`
      throw new CompileError(message, identifier.line, identifier.column)
    }
    const imported = this.imports.use(identifier.name)
    if (imported?.export.kind === 'type') {
      throw new CompileError(`'${identifier.name}' is a type`, identifier.line, identifier.column)
    }
    if (imported !== undefined) return imported.export.type
    const pending = this.top_level?.pending_error(identifier)
    if (pending !== undefined) throw pending
    const builtin = builtins.get(identifier.name)
    if (builtin === undefined) {
      const message = `undefined name '${identifier.name}'`
      throw new CompileError(message, identifier.line, identifier.column)
    }
    return builtin.type
  }

  private type_of_call(call: Call, expected: Type | undefined): Type {
    const { callee } = call
    if (this.collections.is_empty_map(callee))
      return this.collections.type_of_empty_map(call, expected)
    const object_type = this.objects.constructed_type(callee)
    if (object_type !== undefined) return this.objects.type_of_construction(call, object_type)
    if (call.named_args.length > 0) {
      const [{ name }] = call.named_args
      const message = 'named arguments are only used to construct a class or struct'
      throw new CompileError(message, name.line, name.column)
    }
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
    const method =
      this.objects.method_type(object_type, member.name) ?? builtin_method(object_type, name)
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

  // A member that is not called is a field, or a property such as `length`.
  private type_of_property(member: Member): Type {
    const object_type =
      member.object.kind === 'this' && this.self !== undefined
        ? this.record(member.object, this.self.info.type)
        : this.type_of(member.object)
    const { name, line, column } = member.name
    const field_type = this.objects.field_type(object_type, member)
    if (field_type !== undefined) return field_type
    if (this.objects.has_method(object_type, name)) {
      throw new CompileError(`a method must be called: write \`${name}()\``, line, column)
    }
    const property = builtin_property(object_type, name)
    if (property !== undefined) return property
    if (builtin_method(object_type, name) !== undefined) {
      throw new CompileError(`a method must be called: write \`${name}()\``, line, column)
    }
    const message = `type ${format_type(object_type)} has no property '${name}'`
    throw new CompileError(message, line, column)
  }

  // Stringable is a set of types, not one a value can be given, so it is no hint.
  expect_type(expression: Expression, expected: Type): void {
    const hint = expected.kind === 'Stringable' ? undefined : expected
    this.require_type(expression, this.type_of(expression, hint), expected)
  }

  // `x is T`: x has a union type, and T is one of its types.
  private type_of_is_test(test: IsTest): Type {
    const value_type = this.type_of(test.value)
    if (value_type.kind !== 'Union') {
      const message = `expected a value of a union type, got ${format_type(value_type)}`
      throw new CompileError(message, test.value.line, test.value.column)
    }
    const type = this.resolver.resolve(test.type)
    this.types.set(test.type, type)
    if (!value_type.members.some((member) => same_type(member, type))) {
      const message = `${format_type(type)} is not one of the types ${format_type(value_type)}`
      throw new CompileError(message, test.type.line, test.type.column)
    }
    return bool_type
  }

  // Records the type of an expression that is not computed by type_of, such as a type pattern.
  record_type(expression: Expression, type: Type): void {
    this.types.set(expression, type)
  }

  private record(expression: Expression, type: Type): Type {
    this.types.set(expression, type)
    return type
  }

  // A T or nil where a T? is expected is converted, which codegen does where it generates it.
  private require_type(expression: Expression, type: Type, expected: Type): void {
    if (!is_assignable(type, expected)) {
      const message = `expected ${format_type(expected)}, got ${format_type(type)}`
      throw new CompileError(message, expression.line, expression.column)
    }
    if (expected.kind === 'Optional' && type.kind !== 'never' && !same_type(type, expected)) {
      this.conversions.set(expression, expected)
    }
  }

  // A condition is a Bool, or an optional value that holds when it is not nil.
  expect_condition(expression: Expression): Type {
    const type = this.type_of(expression)
    if (!['Bool', 'Optional', 'never'].includes(type.kind)) {
      const message = `expected Bool or an optional value, got ${format_type(type)}`
      throw new CompileError(message, expression.line, expression.column)
    }
    return type
  }

  // The type of an optional value without nil.
  expect_optional(expression: Expression): Type {
    const type = this.type_of(expression)
    if (type.kind !== 'Optional') {
      const message = `expected an optional value, got ${format_type(type)}`
      throw new CompileError(message, expression.line, expression.column)
    }
    return type.inner
  }
}
