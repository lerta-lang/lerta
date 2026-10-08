// Types expressions; ObjectChecker types classes and structs, OperatorChecker the operators,
// CaseChecker case, and CollectionChecker arrays and maps.
import {
  type Call,
  type Expression,
  type Identifier,
  type IsTest,
  type Jump,
  type Member,
  type Position,
  type Return,
} from '../syntax/ast.ts'
import { builtin_method, builtin_property } from './builtins.ts'
import type { Conversions, SelfContext, Shared, Types } from './checker.ts'
import { CaseChecker, type BlockChecker } from './case_checker.ts'
import { check_item_type, check_value_type, CollectionChecker } from './collection_checker.ts'
import { CompileError } from '../errors.ts'
import type { Extensions } from './extensions.ts'
import type { Functions } from './functions.ts'
import { GenericCallChecker } from './generic_call_checker.ts'
import { stringable, type GenericFunction } from './generics.ts'
import type { Export, Imports } from './imports.ts'
import type { TopLevelValues } from './top_level_values.ts'
import type { ObjectTypes } from './object_types.ts'
import { byte_literal } from './literals.ts'
import { ObjectChecker } from './object_checker.ts'
import { OperatorChecker } from './operator_checker.ts'
import type { Scopes } from '../scopes.ts'
import type { TypeResolver } from './type_names.ts'
import {
  bool_type,
  format_type,
  format_types,
  int_type,
  iter_type,
  iterable_item,
  never_type,
  nil_type,
  is_assignable,
  same_type,
  string_type,
  type Type,
} from '../types.ts'

// Checks where `break`, `continue` and `return` are, and what `return` gives.
export type JumpChecker = {
  check_jump(jump: Jump | Return): void
}

export type CheckerLocal = {
  identifier: Identifier
  type: Type
  mutable: boolean
  // Declared with `const` or `var`, as opposed to a loop variable.
  declared: boolean
  used: boolean
  // For a narrowed view of a local (see Scopes.narrow), or one that a function literal captures,
  // the local itself.
  origin?: CheckerLocal
  // Seen from a function literal that captures it (see ClosureChecker.captured).
  captured?: true
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
  private readonly extensions: Extensions
  private readonly top_level: TopLevelValues | undefined
  private readonly jumps: JumpChecker
  private readonly blocks: BlockChecker
  private readonly operators = new OperatorChecker(this)
  private readonly objects: ObjectChecker
  private readonly cases: CaseChecker
  private readonly collections: CollectionChecker
  private readonly generic_calls: GenericCallChecker
  private readonly resolver: TypeResolver

  // `top_level` is given to the checker of a function or a method, which sees the top-level values.
  constructor(
    shared: Shared,
    scopes: Scopes<CheckerLocal>,
    self: SelfContext | undefined,
    top_level: TopLevelValues | undefined,
    blocks: BlockChecker,
    jumps: JumpChecker,
  ) {
    this.jumps = jumps
    this.blocks = blocks
    this.imports = shared.imports
    this.extensions = shared.extensions
    this.top_level = top_level
    this.types = shared.types
    this.conversions = shared.conversions
    this.functions = shared.functions
    this.object_types = shared.objects
    this.scopes = scopes
    this.self = self
    this.objects = new ObjectChecker(this, shared, scopes, self)
    this.cases = new CaseChecker(
      this,
      scopes,
      shared.objects,
      shared.conversions,
      shared.resolver,
      blocks,
    )
    this.resolver = shared.resolver
    this.collections = new CollectionChecker(this, scopes, shared.functions)
    this.generic_calls = new GenericCallChecker(this, shared)
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
          if (typeof part !== 'string') this.check_interpolated(part)
        }
        return string_type
      case 'integer':
        return wants_byte ? byte_literal(expression) : int_type
      case 'nil':
        return nil_type
      case 'throw':
        this.expect_type(expression.message, string_type)
        return never_type
      case 'break':
      case 'continue':
      case 'return':
        this.jumps.check_jump(expression)
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
      case 'comprehension':
        return this.blocks.type_of_comprehension(expression, expected)
      case 'record':
        return this.objects.type_of_record(expression, expected)
      case 'index':
        return this.collections.type_of_index(expression)
      case 'function':
        return this.blocks.type_of_function_literal(expression, expected)
      case 'range':
        throw new CompileError(
          "a range can only be used after 'in' of a 'for'",
          expression.line,
          expression.column,
        )
    }
  }

  // A builtin or a standard module's function can only be called so far, not used as a value.
  private type_of_identifier(identifier: Identifier, is_callee = false): Type {
    const local = this.scopes.lookup(identifier.name)
    if (local !== undefined) {
      ;(local.origin ?? local).used = true
      return local.type
    }
    const function_type = this.functions.type_of(identifier.name, identifier)
    if (function_type !== undefined) return function_type
    if (this.functions.generic(identifier.name) !== undefined) throw this.only_called(identifier)
    if (this.object_types.object_type(identifier.name) !== undefined) {
      const message = `'${identifier.name}' is a type; construct it as ${identifier.name}(...)`
      throw new CompileError(message, identifier.line, identifier.column)
    }
    const imported = this.imports.use(identifier.name)
    if (imported !== undefined) return this.type_of_export(imported.export, identifier, is_callee)
    const pending = this.top_level?.pending_error(identifier)
    if (pending !== undefined) throw pending
    const builtin = this.imports.builtin(identifier.name)
    if (builtin === undefined) {
      const message = `undefined name '${identifier.name}'`
      throw new CompileError(message, identifier.line, identifier.column)
    }
    return this.type_of_export(builtin, identifier, is_callee)
  }

  // A generic function is called through generic_callee, so here it is used as a value.
  private type_of_export(export_: Export, identifier: Identifier, is_callee: boolean): Type {
    switch (export_.kind) {
      case 'type':
        throw new CompileError(`'${identifier.name}' is a type`, identifier.line, identifier.column)
      case 'generic_function':
        throw this.only_called(identifier)
      case 'function':
        if (!is_callee) throw this.only_called(identifier)
        return export_.type
      default:
        return export_.type
    }
  }

  private only_called(identifier: Identifier): CompileError {
    const message = `'${identifier.name}' can only be called so far, not used as a value`
    return new CompileError(message, identifier.line, identifier.column)
  }

  private type_of_call(call: Call, expected: Type | undefined): Type {
    const { callee } = call
    const generic = this.generic_callee(callee)
    if (generic !== undefined) return this.generic_calls.type_of_call(call, generic, expected)
    if (call.type_args.length > 0) {
      const message = 'only a generic function takes type arguments'
      throw new CompileError(message, callee.line, callee.column)
    }
    if (this.collections.is_empty_map(callee))
      return this.collections.type_of_empty_map(call, expected)
    const object_type = this.objects.constructed_type(callee)
    if (object_type !== undefined) return this.objects.type_of_construction(call, object_type)
    if (callee.kind === 'member') {
      const receiver_type = this.type_of(callee.object)
      const mapped_item = callee.name.name === 'map' ? iterable_item(receiver_type) : undefined
      if (mapped_item !== undefined) return this.type_of_map(call, mapped_item, expected)
      return this.check_arguments(call, this.type_of_method(callee, receiver_type))
    }
    const callee_type =
      callee.kind === 'identifier'
        ? this.record(callee, this.type_of_identifier(callee, true))
        : this.type_of(callee)
    return this.check_arguments(call, callee_type)
  }

  // The generic function that the callee names: one of the module, an imported one or a builtin,
  // unless a local or another name of the module takes the name.
  private generic_callee(callee: Expression): GenericFunction | undefined {
    if (callee.kind !== 'identifier') return undefined
    const { name } = callee
    if (this.scopes.lookup(name) !== undefined || this.top_level?.has(name)) return undefined
    if (this.functions.has(name)) return this.functions.generic(name)
    const export_ = this.imports.get(name)?.export ?? this.imports.builtin(name)
    if (export_?.kind !== 'generic_function') return undefined
    this.imports.use(name)
    return export_.generic
  }

  // The result of a call of a function of the type, once its arguments are checked.
  private check_arguments(call: Call, callee_type: Type): Type {
    if (callee_type.kind !== 'function') {
      const message = `cannot call a value of type ${format_type(callee_type)}`
      throw new CompileError(message, call.line, call.column)
    }
    const { params } = callee_type
    if (call.named_args.length > 0) this.gather_named_args(call, params.at(-1))
    if (call.args.length !== params.length) {
      const message = `expected ${params.length} argument(s), got ${call.args.length}`
      throw new CompileError(message, call.line, call.column)
    }
    call.args.forEach((arg, i) => this.expect_type(arg, params[i]))
    return callee_type.result
  }

  // `xs.map(f)`: an Iter of f's results for the items, whose type f's result gives, unless an
  // Iter of a type is expected, as for a lazy comprehension.
  private type_of_map(call: Call, item: Type, expected: Type | undefined): Type {
    if (call.named_args.length > 0) {
      const { line, column } = call.named_args[0].name
      throw new CompileError('map takes no named arguments', line, column)
    }
    if (call.args.length !== 1) {
      const message = `expected 1 argument(s), got ${call.args.length}`
      throw new CompileError(message, call.line, call.column)
    }
    const [mapper] = call.args
    const type =
      mapper.kind === 'function'
        ? this.blocks.type_of_item_function(
            mapper,
            item,
            expected?.kind === 'Iter' ? expected.item : undefined,
          )
        : this.type_of(mapper)
    const fits = type.kind === 'function' && type.params.length === 1
    if (!fits || !same_type(type.params[0], item)) {
      const message = `expected a function of ${format_type(item)}, got ${format_type(type)}`
      throw new CompileError(message, mapper.line, mapper.column)
    }
    return iter_type(check_value_type(type.result, mapper, 'an Iter'))
  }

  // Named arguments are the fields of an anonymous struct for the last parameter: `draw(x: 1, y: 2)`
  // is `draw({ x: 1, y: 2 })`. The call is rewritten into that form so that codegen, which reads
  // named arguments only as a construction, generates it as any other call. Every pass reading the
  // arguments (jump_positions, codegen) visits the same values in either form.
  private gather_named_args(call: Call, last_param: Type | undefined): void {
    const [{ name }] = call.named_args
    const record = last_param?.kind === 'Optional' ? last_param.inner : last_param
    if (record?.kind !== 'Record') {
      const message =
        'named arguments construct a class or struct, or give a last parameter of an anonymous struct type'
      throw new CompileError(message, name.line, name.column)
    }
    const fields = call.named_args.map((arg) => ({ name: arg.name, value: arg.value }))
    call.args.push({ kind: 'record', fields, line: name.line, column: name.column })
    call.named_args = []
  }

  private type_of_method(member: Member, object_type: Type): Type {
    const { name, line, column } = member.name
    this.reject_deinit(object_type, member)
    const method = this.find_method(object_type, member)
    if (method === undefined) {
      throw new CompileError(
        `type ${format_type(object_type)} has no method '${name}'`,
        line,
        column,
      )
    }
    if (object_type.kind === 'Iter' && name === 'to_array') {
      check_item_type(object_type.item, member, 'an array')
    }
    this.types.set(member, method)
    return method
  }

  // The type of the method that `member` names, if the object's type has it: its own, from an
  // extend, built in, or a field that holds a function.
  private find_method(object_type: Type, member: Member): Type | undefined {
    return (
      this.objects.method_type(object_type, member.name) ??
      this.extensions.method_type(object_type, member.name) ??
      builtin_method(object_type, member.name.name) ??
      this.objects.field_type(object_type, member)
    )
  }

  // The type of `to_string(): String` of the type, if it is Stringable: a method of its own, from an
  // extend or built in; a field that holds a function does not count.
  private stringable_method(type: Type, at: Position): Type | undefined {
    const { line, column } = at
    const name: Identifier = { kind: 'identifier', name: 'to_string', line, column }
    const method =
      this.objects.method_type(type, name) ??
      this.extensions.method_type(type, name) ??
      builtin_method(type, name.name)
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
  private check_interpolated(part: Call): void {
    const member = part.callee as Member
    const type = this.type_of(member.object)
    const method = this.stringable_method(type, member)
    if (method === undefined) throw this.stringable_error(type, member.object)!
    this.types.set(member, method)
    this.types.set(part, string_type)
  }

  // A class's deinit is only run by a release.
  private reject_deinit(object_type: Type, member: Member): void {
    const { name, line, column } = member.name
    if (name !== 'deinit' || !this.objects.has_method(object_type, name)) return
    const message = 'deinit runs when the object is released; it cannot be called or used'
    throw new CompileError(message, line, column)
  }

  // A member that is not called is a field, or a property such as `length`.
  private type_of_property(member: Member): Type {
    const object_type =
      member.object.kind === 'this' && this.self !== undefined
        ? this.record(member.object, this.self.type)
        : this.type_of(member.object)
    const { name, line, column } = member.name
    this.reject_deinit(object_type, member)
    const field_type = this.objects.field_type(object_type, member)
    if (field_type !== undefined) return field_type
    const property = builtin_property(object_type, name)
    if (property !== undefined) return property
    const is_map = name === 'map' && iterable_item(object_type) !== undefined
    const is_method =
      this.objects.has_method(object_type, name) ||
      this.extensions.find(object_type, name) !== undefined ||
      builtin_method(object_type, name) !== undefined ||
      is_map
    if (is_method) {
      throw new CompileError(`a method must be called: write \`${name}()\``, line, column)
    }
    const message = `type ${format_type(object_type)} has no property '${name}'`
    throw new CompileError(message, line, column)
  }

  expect_type(expression: Expression, expected: Type): void {
    this.require_type(expression, this.type_of(expression, expected), expected)
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
  require_type(expression: Expression, type: Type, expected: Type): void {
    if (!is_assignable(type, expected)) {
      const [expected_text, type_text] = format_types(expected, type)
      const message = `expected ${expected_text}, got ${type_text}`
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
