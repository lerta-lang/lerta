// Types expressions; NameChecker types names, MemberChecker members, ObjectChecker classes and
// structs, OperatorChecker the operators, CaseChecker case, and CollectionChecker arrays and maps.
import type { Call, Expression, Identifier, IsTest, Jump, Member, Return } from '../syntax/ast.ts'
import type { Conversions, SelfContext, Shared, Types } from './shared.ts'
import { CaseChecker, type BlockChecker } from './case_checker.ts'
import { CollectionChecker } from './collection_checker.ts'
import { CompileError } from '../errors.ts'
import { GenericCallChecker } from './generic_call_checker.ts'
import type { TopLevelValues } from './top_level_values.ts'
import { byte_literal } from './literals.ts'
import { MemberChecker } from './member_checker.ts'
import { NameChecker } from './name_checker.ts'
import { ObjectChecker } from './object_checker.ts'
import { OperatorChecker } from './operator_checker.ts'
import type { Scopes } from '../scopes.ts'
import type { TypeResolver } from './type_names.ts'
import {
  bool_type,
  format_type,
  format_types,
  int_type,
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
  private readonly conversions: Conversions
  private readonly jumps: JumpChecker
  private readonly blocks: BlockChecker
  private readonly names: NameChecker
  private readonly operators = new OperatorChecker(this)
  private readonly objects: ObjectChecker
  private readonly members: MemberChecker
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
    this.types = shared.types
    this.conversions = shared.conversions
    this.names = new NameChecker(shared, scopes, top_level)
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
    this.generic_calls = new GenericCallChecker(this, shared, (type, at) =>
      this.members.stringable_error(type, at),
    )
    this.members = new MemberChecker(this, this.objects, this.generic_calls, shared, self)
  }

  field_target(member: Member): Type {
    return this.objects.field_target(member)
  }

  type_of(expression: Expression, expected?: Type): Type {
    return this.record_type(expression, this.compute_type(expression, expected))
  }

  // `expected` is a hint: the caller still checks that the type fits.
  private compute_type(expression: Expression, expected: Type | undefined): Type {
    const wants_byte = expected?.kind === 'Byte'
    switch (expression.kind) {
      case 'string':
        return wants_byte ? byte_literal(expression) : string_type
      case 'interpolation':
        for (const part of expression.parts) {
          if (typeof part !== 'string') this.members.check_interpolated(part)
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
        return this.names.type_of_identifier(expression)
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
        return this.members.type_of_property(expression)
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

  private type_of_call(call: Call, expected: Type | undefined): Type {
    const { callee } = call
    const generic = this.names.generic_callee(callee)
    if (generic !== undefined) return this.generic_calls.type_of_call(call, generic, expected)
    if (call.type_args.length > 0) {
      const message = 'only a generic function takes type arguments'
      throw new CompileError(message, callee.line, callee.column)
    }
    if (this.collections.is_empty_map(callee))
      return this.collections.type_of_empty_map(call, expected)
    const object_type = this.objects.constructed_type(callee)
    if (object_type !== undefined) return this.objects.type_of_construction(call, object_type)
    if (callee.kind === 'member') return this.members.type_of_method_call(call, callee, expected)
    const callee_type =
      callee.kind === 'identifier'
        ? this.record_type(callee, this.names.type_of_identifier(callee, true))
        : this.type_of(callee)
    return this.check_arguments(call, callee_type)
  }

  // The result of a call of a function of the type, once its arguments are checked.
  check_arguments(call: Call, callee_type: Type): Type {
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

  // Records the type of an expression, which type_of may not compute, such as a type pattern.
  record_type(expression: Expression, type: Type): Type {
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
