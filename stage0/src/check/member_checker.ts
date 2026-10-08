// Types the members of values: method calls, `x.name(...)`, and properties, `x.name`; and decides
// which types are Stringable, by their method to_string.
import type { Call, Identifier, Member, Position } from '../syntax/ast.ts'
import { builtin_property } from './builtins.ts'
import { CompileError } from '../errors.ts'
import type { ExpressionChecker } from './expression_checker.ts'
import { plain_method_type, type Extensions } from './extensions.ts'
import type { GenericCallChecker } from './generic_call_checker.ts'
import { stringable } from './generics.ts'
import { find_method, type MethodSource } from './methods.ts'
import type { ObjectChecker } from './object_checker.ts'
import type { ObjectTypes } from './object_types.ts'
import type { SelfContext, Shared } from './shared.ts'
import { format_type, is_assignable, string_type, type Type } from '../types.ts'

export class MemberChecker {
  private readonly expressions: ExpressionChecker
  private readonly objects: ObjectChecker
  private readonly generic_calls: GenericCallChecker
  private readonly object_types: ObjectTypes
  private readonly extensions: Extensions
  private readonly self: SelfContext | undefined

  constructor(
    expressions: ExpressionChecker,
    objects: ObjectChecker,
    generic_calls: GenericCallChecker,
    shared: Shared,
    self: SelfContext | undefined,
  ) {
    this.expressions = expressions
    this.objects = objects
    this.generic_calls = generic_calls
    this.object_types = shared.objects
    this.extensions = shared.extensions
    this.self = self
  }

  // The result of a call of the method that `member` names: a method of the object's type (see
  // find_method), or a field that holds a function.
  type_of_method_call(call: Call, member: Member, expected: Type | undefined): Type {
    const receiver = this.expressions.type_of(member.object)
    const source = this.find(receiver, member.name.name)
    const generic = source?.kind === 'extension' ? source.method.generic : undefined
    if (generic === undefined) {
      return this.expressions.check_arguments(call, this.type_of_method(member, receiver, source))
    }
    const method = this.generic_calls.type_of_method_call(call, member, generic, receiver, expected)
    this.expressions.record_type(member, method)
    return method.result
  }

  private type_of_method(member: Member, receiver: Type, source: MethodSource | undefined): Type {
    const { name, line, column } = member.name
    this.reject_deinit(receiver, member)
    const method =
      (source === undefined ? undefined : this.method_type(receiver, source, member.name)) ??
      this.objects.field_type(receiver, member)
    if (method === undefined) {
      const message = `type ${format_type(receiver)} has no method '${name}'`
      throw new CompileError(message, line, column)
    }
    this.expressions.record_type(member, method)
    return method
  }

  private find(receiver: Type, name: string): MethodSource | undefined {
    return find_method(receiver, name, this.object_types, this.extensions)
  }

  // The type of the method, checking its body first if needed. A generic one's comes from its
  // instance for the receiver, if the receiver gives all its type arguments; `call`, if given,
  // calls it.
  private method_type(
    receiver: Type,
    source: MethodSource,
    name: Identifier,
    call?: Call,
  ): Type | undefined {
    switch (source.kind) {
      case 'own':
        return this.objects.method_type(source.receiver, name)
      case 'builtin':
        return source.type
      case 'extension': {
        const { method } = source
        if (method.generic === undefined) return plain_method_type(method, name)
        return this.generic_calls.receiver_instance(method.generic, receiver, name, call)?.type
      }
    }
  }

  // The type of `to_string(): String` of the type, if it is Stringable; a field that holds a
  // function does not count.
  private stringable_method(type: Type, at: Position, call?: Call): Type | undefined {
    const { line, column } = at
    const name: Identifier = { kind: 'identifier', name: 'to_string', line, column }
    const source = this.find(type, name.name)
    const method = source === undefined ? undefined : this.method_type(type, source, name, call)
    const is_stringable =
      method?.kind === 'function' &&
      method.params.length === 0 &&
      is_assignable(method.result, string_type)
    return is_stringable ? method : undefined
  }

  // The error for a type that is not Stringable, or none.
  stringable_error(type: Type, at: Position): CompileError | undefined {
    if (this.stringable_method(type, at) !== undefined) return undefined
    const message = `${format_type(type)} is not ${stringable}: it has no method to_string(): String`
    return new CompileError(message, at.line, at.column)
  }

  // `"#{x}"` calls `x.to_string()` (see Interpolation), which it records as typed here, so that x
  // is typed once.
  check_interpolated(part: Call): void {
    const member = part.callee as Member
    const type = this.expressions.type_of(member.object)
    const method = this.stringable_method(type, member, part)
    if (method === undefined) throw this.stringable_error(type, member.object)!
    this.expressions.record_type(member, method)
    this.expressions.record_type(part, string_type)
  }

  // A class's deinit is only run by a release.
  private reject_deinit(object_type: Type, member: Member): void {
    const { name, line, column } = member.name
    if (name !== 'deinit' || !this.objects.has_method(object_type, name)) return
    const message = 'deinit runs when the object is released; it cannot be called or used'
    throw new CompileError(message, line, column)
  }

  // A member that is not called is a field, or a property such as `length`.
  type_of_property(member: Member): Type {
    const object_type =
      member.object.kind === 'this' && this.self !== undefined
        ? this.expressions.record_type(member.object, this.self.type)
        : this.expressions.type_of(member.object)
    const { name, line, column } = member.name
    this.reject_deinit(object_type, member)
    const field_type = this.objects.field_type(object_type, member)
    if (field_type !== undefined) return field_type
    const property = builtin_property(object_type, name)
    if (property !== undefined) return property
    if (this.find(object_type, name) !== undefined) {
      throw new CompileError(`a method must be called: write \`${name}()\``, line, column)
    }
    const message = `type ${format_type(object_type)} has no property '${name}'`
    throw new CompileError(message, line, column)
  }
}
