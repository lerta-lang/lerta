// Types classes and structs: construction, fields, `@` and methods.
import type { Call, Expression, Identifier, Member, RecordLiteral } from '../syntax/ast.ts'
import type { SelfContext, Shared, Types } from './checker.ts'
import { CompileError } from '../errors.ts'
import type { CheckerLocal, ExpressionChecker } from './expression_checker.ts'
import { method_key, type Functions } from './functions.ts'
import type { FieldInfo, ObjectTypes } from './object_types.ts'
import type { Scopes } from '../scopes.ts'
import { format_type, record_type, type Type } from '../types.ts'

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

  // `@` is a local of a method's body (see StatementChecker.check_function_body), which a function
  // literal in it captures like any other. An initializer has no such local: there the object is
  // not complete, so `@` can only read the fields set before (see field_of), not be passed on or
  // called, which could reach the others.
  type_of_this(at: Expression): Type {
    const local = this.scopes.lookup('@')
    if (local !== undefined) return local.type
    const message =
      this.self !== undefined
        ? 'an initializer can only use `@` to read a field, as in `@name`'
        : "'@' can only be used in a method, a function literal in a method, or a field initializer"
    throw new CompileError(message, at.line, at.column)
  }

  // The type of the field `member` names, of a class, a struct or an anonymous struct.
  field_type(object_type: Type, member: Member): Type | undefined {
    if (object_type.kind === 'Record') {
      return object_type.fields.find((field) => field.name === member.name.name)?.type
    }
    return this.field_of(object_type, member)?.type
  }

  // `{ x: 1, y }`. Its fields take their types from the expected type, if it is an anonymous
  // struct with the same fields, so that `{ x: nil }` can be typed.
  type_of_record(record: RecordLiteral, expected: Type | undefined): Type {
    const names = new Set<string>()
    for (const { name } of record.fields) {
      if (names.has(name.name)) {
        throw new CompileError(`'${name.name}' is already a field`, name.line, name.column)
      }
      names.add(name.name)
    }
    const expected_record = expected?.kind === 'Optional' ? expected.inner : expected
    const expected_fields = expected_record?.kind === 'Record' ? expected_record.fields : []
    const fields = record.fields.map(({ name, value }) => {
      const expected_type = expected_fields.find((field) => field.name === name.name)?.type
      if (expected_type !== undefined) {
        this.expressions.expect_type(value, expected_type)
        return { name: name.name, type: expected_type }
      }
      const type = this.expressions.type_of(value)
      if (['void', 'never', 'nil'].includes(type.kind)) {
        const message = `a field cannot hold a value of type ${format_type(type)}`
        throw new CompileError(message, value.line, value.column)
      }
      return { name: name.name, type }
    })
    return record_type(fields)
  }

  // The type of a field that is assigned to, which must be a field that can be changed.
  field_target(member: Member): Type {
    const object_type = this.expressions.type_of(member.object)
    const field = this.field_of(object_type, member)
    const { name, line, column } = member.name
    if (object_type.kind === 'Record') {
      throw new CompileError('a field of an anonymous struct cannot be changed', line, column)
    }
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
