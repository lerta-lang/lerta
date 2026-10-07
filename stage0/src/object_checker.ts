// Types classes and structs: construction, fields, `@` and methods.
import type { Call, Expression, Identifier, Member } from './ast.ts'
import type { SelfContext, Shared, Types } from './checker.ts'
import { CompileError } from './errors.ts'
import type { CheckerLocal, ExpressionChecker } from './expression_checker.ts'
import { method_key, type Functions } from './functions.ts'
import type { FieldInfo, ObjectTypes } from './object_types.ts'
import type { Scopes } from './scopes.ts'
import { format_type, type Type } from './types.ts'

export class ObjectChecker {
  private readonly expressions: ExpressionChecker
  private readonly types: Types
  private readonly functions: Functions
  private readonly objects: ObjectTypes
  private readonly scopes: Scopes<CheckerLocal>
  private readonly self: SelfContext | undefined

  constructor(
    expressions: ExpressionChecker,
    shared: Shared,
    scopes: Scopes<CheckerLocal>,
    self: SelfContext | undefined,
  ) {
    this.expressions = expressions
    this.types = shared.types
    this.functions = shared.functions
    this.objects = shared.objects
    this.scopes = scopes
    this.self = self
  }

  // A call to the name of a class or struct, not shadowed by a local or a function, constructs
  // one. The callee is recorded with the object type, which codegen recognizes.
  constructed_type(callee: Expression): Type | undefined {
    if (callee.kind !== 'identifier') return undefined
    const { name } = callee
    if (this.scopes.lookup(name) !== undefined || this.functions.has(name)) return undefined
    const type = this.objects.object_type(name)
    if (type !== undefined) this.types.set(callee, type)
    return type
  }

  // Every argument is named. Fields without an initializer are the arguments; an optional one may
  // be left out and is then nil.
  type_of_construction(call: Call, type: Type): Type {
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
      this.expressions.expect_type(arg.value, field.type!)
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

  // The type of the method `name` of an object, or undefined if the type is no class or struct
  // with that method.
  method_type(object_type: Type, name: Identifier): Type | undefined {
    if (!this.has_method(object_type, name.name)) return undefined
    const { functions } = this.objects.info(object_type)
    return functions!.type_of(method_key(object_type.name, name.name), name)
  }

  // A type guard, so that a caller can go on with the object type once it knows the method exists.
  has_method(object_type: Type, name: string): object_type is Extract<Type, { kind: 'Object' }> {
    return object_type.kind === 'Object' && this.objects.info(object_type).methods.has(name)
  }

  // In an initializer, the object is not complete, so it can only be used to read the fields set
  // before (see field_of): not passed on or called, which could reach the others.
  type_of_this(at: Expression): Type {
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

  // The type of the field `member` names, if its object is a class or struct.
  field_type(object_type: Type, member: Member): Type | undefined {
    return this.field_of(object_type, member)?.type
  }

  // The type of a field that is assigned to, which must be a field that can be changed.
  field_target(member: Member): Type {
    const object_type = this.expressions.type_of(member.object)
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
}
