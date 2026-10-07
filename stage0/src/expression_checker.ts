import {
  type ArrayLiteral,
  type Binary,
  type Call,
  type Case,
  type Expression,
  type Identifier,
  type Index,
  type Member,
} from './ast.ts'
import { builtin_method, builtin_property, builtins } from './builtins.ts'
import type { Conversions, SelfContext, Shared, Types } from './checker.ts'
import { CompileError } from './errors.ts'
import { method_key, type Functions } from './functions.ts'
import type { FieldInfo, ObjectTypes } from './object_types.ts'
import { byte_literal, is_contextual } from './literals.ts'
import { OperatorChecker } from './operator_checker.ts'
import type { Scopes } from './scopes.ts'
import {
  array_type,
  bool_type,
  format_type,
  int_type,
  nil_type,
  is_assignable,
  is_reference_type,
  same_type,
  string_type,
  stringable_type,
  uint8_type,
  unify,
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
  private readonly objects: ObjectTypes
  private readonly self: SelfContext | undefined
  private readonly operators = new OperatorChecker(this)

  constructor(shared: Shared, scopes: Scopes<CheckerLocal>, self: SelfContext | undefined) {
    this.types = shared.types
    this.conversions = shared.conversions
    this.functions = shared.functions
    this.objects = shared.objects
    this.scopes = scopes
    this.self = self
  }

  // The field `member` names, with its type, if its object is a class or struct. In a field
  // initializer, `@x` must name an argument or a field initialized before.
  private field_of(object_type: Type, member: Member): { info: FieldInfo; type: Type } | undefined {
    if (object_type.kind !== 'Object') return undefined
    const object = this.objects.info(object_type)
    const field = object.fields.find((field) => field.name.name === member.name.name)
    if (field === undefined) return undefined
    const initializing = this.self?.initializing
    if (member.object.kind === 'this' && initializing !== undefined && field.value !== undefined) {
      const fields = object.fields
      if (fields.indexOf(field) >= fields.indexOf(initializing)) {
        const message = `'${field.name.name}' is not initialized yet`
        throw new CompileError(message, member.name.line, member.name.column)
      }
    }
    return { info: field, type: this.objects.field_type(object, field, member.name) }
  }

  // The type of a field that is assigned to, which must be a field that can be changed.
  field_target(member: Member): Type {
    const object_type = this.type_of(member.object)
    const field = this.field_of(object_type, member)
    const { name, line, column } = member.name
    if (field === undefined) {
      throw new CompileError(
        `type ${format_type(object_type)} has no field '${name}'`,
        line,
        column,
      )
    }
    if (!field.info.mutable) {
      const message =
        object_type.kind === 'Object' && object_type.is_struct
          ? 'a struct field cannot be changed'
          : `'${name}' is a const field`
      throw new CompileError(message, line, column)
    }
    this.types.set(member, field.type)
    return field.type
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
      case 'this':
        return this.type_of_this(expression)
      case 'unwrap':
        return this.expect_optional(expression.operand)
      case 'coalesce':
        return this.operators.type_of_coalesce(expression)
      case 'boolean':
        return bool_type
      case 'identifier':
        return this.type_of_identifier(expression)
      case 'call':
        return this.type_of_call(expression)
      case 'unary':
        return this.operators.type_of_unary(expression, expected)
      case 'binary':
        return this.operators.type_of_binary(expression, expected)
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
      ;(local.origin ?? local).used = true
      return local.type
    }
    const function_type = this.functions.type_of(identifier.name, identifier)
    if (function_type !== undefined) return function_type
    if (this.objects.object_type(identifier.name) !== undefined) {
      const message = `'${identifier.name}' is a type; construct it as ${identifier.name}(...)`
      throw new CompileError(message, identifier.line, identifier.column)
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
    const object_type = this.constructed_type(callee)
    if (object_type !== undefined) return this.type_of_construction(call, object_type)
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

  // A call to the name of a class or struct, not shadowed by a local or a function, constructs
  // one. The callee is recorded with the object type, which codegen recognizes.
  private constructed_type(callee: Expression): Type | undefined {
    if (callee.kind !== 'identifier') return undefined
    const { name } = callee
    if (this.scopes.lookup(name) !== undefined || this.functions.has(name)) return undefined
    const type = this.objects.object_type(name)
    if (type !== undefined) this.types.set(callee, type)
    return type
  }

  // Every argument is named. Fields without an initializer are the arguments; an optional one may
  // be left out and is then nil.
  private type_of_construction(call: Call, type: Type): Type {
    const info = this.objects.info(type)
    if (call.args.length > 0) {
      const [first] = call.args
      const message = `${format_type(type)} is constructed with named arguments, as in Point(x: 1)`
      throw new CompileError(message, first.line, first.column)
    }
    const given = new Set<string>()
    for (const arg of call.named_args) {
      if (given.has(arg.name.name)) {
        const message = `the argument '${arg.name.name}' is given twice`
        throw new CompileError(message, arg.name.line, arg.name.column)
      }
      given.add(arg.name.name)
      const field = info.fields.find((field) => field.name.name === arg.name.name)
      if (field === undefined || field.value !== undefined) {
        const reason = field === undefined ? 'has no field' : 'computes its field'
        const message = `${format_type(type)} ${reason} '${arg.name.name}'`
        throw new CompileError(message, arg.name.line, arg.name.column)
      }
      this.expect_type(arg.value, field.type!)
    }
    for (const field of info.fields) {
      const is_required = field.value === undefined && field.type!.kind !== 'Optional'
      if (is_required && !given.has(field.name.name)) {
        const message = `missing argument '${field.name.name}'`
        throw new CompileError(message, call.line, call.column)
      }
    }
    return type
  }

  private type_of_method(member: Member): Type {
    const object_type = this.type_of(member.object)
    const { name, line, column } = member.name
    const method =
      object_type.kind === 'Object' && this.objects.info(object_type).methods.has(name)
        ? this.functions.type_of(method_key(object_type.name, name), member.name)
        : builtin_method(object_type, name)
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

  // In an initializer, the object is not complete, so it can only be used to read the fields set
  // before (see field_of): not passed on or called, which could reach the others.
  private type_of_this(at: Expression): Type {
    if (this.self === undefined) {
      const message = "'@' can only be used in a method or a field initializer"
      throw new CompileError(message, at.line, at.column)
    }
    if (this.self.initializing !== undefined) {
      const message = 'an initializer can only use `@` to read a field, as in `@name`'
      throw new CompileError(message, at.line, at.column)
    }
    return this.self.info.type
  }

  // A member that is not called is a field, or a property such as `length`.
  private type_of_property(member: Member): Type {
    const object_type =
      member.object.kind === 'this' && this.self !== undefined
        ? this.record(member.object, this.self.info.type)
        : this.type_of(member.object)
    const { name, line, column } = member.name
    const field = this.field_of(object_type, member)
    if (field !== undefined) return field.type
    const is_method =
      object_type.kind === 'Object' && this.objects.info(object_type).methods.has(name)
    if (is_method) {
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
    // An item is 8 bytes, which cannot hold an optional Int, UInt8 or Bool.
    const is_optional_value = element.kind === 'Optional' && !is_reference_type(element)
    if (element.kind === 'nil') {
      const message = 'nil alone does not give the type of an array; write it in an annotation'
      throw new CompileError(message, anchor.line, anchor.column)
    }
    if (element.kind === 'void' || element.kind === 'function' || is_optional_value) {
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
    // A mix of T, T? and nil gives T?, to which the arms are converted.
    const value_types = values.map((value) => this.type_of(value))
    let type = value_types[0]
    values.forEach((value, i) => {
      const unified = unify(type, value_types[i])
      if (unified === undefined) {
        const types = `expected ${format_type(type)}, got ${format_type(value_types[i])}`
        const message = `case arms must have the same type: ${types}`
        throw new CompileError(message, value.line, value.column)
      }
      type = unified
    })
    if (type.kind === 'nil') {
      const message = 'nil alone does not give the type of a case; write it in an annotation'
      throw new CompileError(message, case_expression.line, case_expression.column)
    }
    values.forEach((value, i) => {
      if (!same_type(value_types[i], type)) this.conversions.set(value, type)
    })
    return type
  }

  // Stringable is a set of types, not one a value can be given, so it is no hint.
  expect_type(expression: Expression, expected: Type): void {
    const hint = expected.kind === 'Stringable' ? undefined : expected
    this.require_type(expression, this.type_of(expression, hint), expected)
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
    if (expected.kind === 'Optional' && !same_type(type, expected)) {
      this.conversions.set(expression, expected)
    }
  }

  // A condition is a Bool, or an optional value that holds when it is not nil.
  expect_condition(expression: Expression): Type {
    const type = this.type_of(expression)
    if (type.kind !== 'Bool' && type.kind !== 'Optional') {
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
