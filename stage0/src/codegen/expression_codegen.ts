import type { Expression, Identifier, Interpolation, Member, Throw } from '../syntax/ast.ts'
import { emit_length } from './array_codegen.ts'
import { emit_binary_length } from './binary_codegen.ts'
import { CallGenerator } from './call_codegen.ts'
import { emit_function_closure } from './closure_codegen.ts'
import { emit_record, emit_record_field } from './record_codegen.ts'
import { CaseGenerator, type BlockGenerator } from './case_codegen.ts'
import { CollectionGenerator } from './collection_codegen.ts'
import type { Checked } from '../check/checker.ts'
import type { CheckedInt } from './checked_int.ts'
import type { IrBuilder } from './ir_builder.ts'
import { emit_release, emit_retain, ir_type, string_constant } from './lerta_ir.ts'
import { emit_map_length } from './map_codegen.ts'
import { emit_is_present, emit_unwrap, emit_wrap, nil_constant } from './optional_codegen.ts'
import { OperatorGenerator } from './operator_codegen.ts'
import { emit_field_pointer, emit_type_test } from './object_codegen.ts'
import type { ObjectTypes } from '../check/object_types.ts'
import type { Scopes } from '../scopes.ts'
import type { Conversions, Types } from '../check/shared.ts'
import { emit_unreachable } from './extern_codegen.ts'
import { emit_concat } from './string_codegen.ts'
import type { ThrowBlocks } from './throw_blocks.ts'
import { emit_initialized_check, type TopLevelGlobal } from './top_level_codegen.ts'
import { is_reference_type, type Type } from '../types.ts'

// A loop variable or a parameter is an SSA value; a `const` or `var` lives in a stack slot.
// A slot of a top-level value is its global (see top_level_codegen.ts); outside the top-level code,
// it is checked to be initialized before it is used. A slot of a var that function literals
// capture points into its cell (see cell_codegen.ts).
export type CodegenLocal =
  | { kind: 'value'; operand: string; type: Type }
  | { kind: 'slot'; pointer: string; type: Type; top_level?: TopLevelSlot; cell?: CellSlot }

// The cell of a captured var, which the scope that declares it owns; a function literal's scope
// reads it from its closure, which owns it.
export type CellSlot = { cell: string; is_owned: boolean }

export type TopLevelSlot = { global: TopLevelGlobal; is_checked: boolean }

// The slot's pointer, once a top-level value is known to be initialized.
export const slot_pointer = (
  ir: IrBuilder,
  local: Extract<CodegenLocal, { kind: 'slot' }>,
): string => {
  if (local.top_level?.is_checked) emit_initialized_check(ir, local.top_level.global)
  return local.pointer
}

// Expressions. Each yields an IR operand; a reference-typed one is owned by the consumer.
export class ExpressionGenerator {
  private readonly ir: IrBuilder
  private readonly types: Types
  private readonly locals: Scopes<CodegenLocal>
  // The symbols of top-level functions, own and imported.
  private readonly function_symbols: Map<string, string>

  private readonly conversions: Conversions
  private readonly objects: ObjectTypes
  private readonly calls: CallGenerator
  private readonly operators: OperatorGenerator
  private readonly cases: CaseGenerator
  private readonly blocks: BlockGenerator
  private readonly collections: CollectionGenerator

  constructor(
    ir: IrBuilder,
    checked: Pick<
      Checked,
      'types' | 'conversions' | 'objects' | 'imports' | 'extensions' | 'instances'
    >,
    throws: ThrowBlocks,
    checked_int: CheckedInt,
    locals: Scopes<CodegenLocal>,
    function_symbols: Map<string, string>,
    blocks: BlockGenerator,
  ) {
    this.ir = ir
    this.types = checked.types
    this.conversions = checked.conversions
    this.objects = checked.objects
    this.calls = new CallGenerator(this, ir, checked, locals, function_symbols)
    this.operators = new OperatorGenerator(this, ir, checked.types, checked_int, throws)
    this.blocks = blocks
    this.cases = new CaseGenerator(this, ir, checked.types, blocks)
    this.collections = new CollectionGenerator(this, ir, checked.types)
    this.locals = locals
    this.function_symbols = function_symbols
  }

  // Returns the IR operand holding the value, converted where it is used (an Int as an Int?, for
  // example); void calls return ''.
  generate(expression: Expression): string {
    const target = this.conversions.get(expression)
    if (expression.kind === 'nil') return nil_constant(target!)
    const operand = this.generate_value(expression)
    if (target === undefined) return operand
    return emit_wrap(this.ir, operand, this.types.get(expression)!)
  }

  // The type of the operand that `generate` returns: the type the expression is converted to, if
  // it is.
  type_at_use(expression: Expression): Type {
    return this.conversions.get(expression) ?? this.types.get(expression)!
  }

  // An i1 for a condition: a Bool, or an optional value that holds when not nil (a Bool? holds
  // when it is true).
  generate_condition(expression: Expression): string {
    const operand = this.generate(expression)
    const type = this.types.get(expression)!
    if (type.kind !== 'Optional') return operand
    const present = emit_is_present(this.ir, operand, type)
    this.release_if_reference(expression, operand)
    if (type.inner.kind !== 'Bool') return present
    const value = emit_unwrap(this.ir, operand, type)
    return this.ir.assign(`and i1 ${present}, ${value}`)
  }

  private generate_value(expression: Expression): string {
    switch (expression.kind) {
      case 'nil':
        throw new Error('nil is generated by generate, where it is converted')
      case 'throw':
        return this.generate_throw(expression)
      case 'break':
      case 'continue':
      case 'return':
        this.blocks.generate_jump(expression)
        return 'poison'
      case 'is': {
        const object = this.generate(expression.value)
        const type = this.types.get(expression.type)!
        if (type.kind !== 'Object') throw new Error('is tests a class or struct')
        const test = emit_type_test(this.ir, object, type)
        emit_release(this.ir, object)
        return test
      }
      case 'this': {
        const object = this.locals.lookup('@')!
        return this.read_local(object, object.type)
      }
      case 'unwrap':
        return this.operators.generate_unwrap(expression)
      case 'coalesce':
        return this.operators.generate_coalesce(expression)
      case 'string':
        if (this.types.get(expression)!.kind === 'UInt8') {
          return new TextEncoder().encode(expression.value)[0].toString()
        }
        return string_constant(this.ir, expression.value)
      case 'interpolation':
        return this.generate_interpolation(expression)
      case 'integer':
        return expression.value.toString()
      case 'boolean':
        return expression.value ? 'true' : 'false'
      case 'call':
        return this.calls.generate_call(expression)
      case 'unary':
        return this.operators.generate_unary(expression)
      case 'binary':
        return this.operators.generate_binary(expression)
      case 'case':
        return this.cases.generate(expression)
      case 'conditional':
        return this.cases.generate_conditional(expression)
      case 'identifier':
        return this.generate_identifier(expression)
      case 'range':
        throw new Error('ranges are only generated by for')
      case 'member':
        return this.generate_property(expression)
      case 'array':
        return this.collections.generate_array(expression)
      case 'map':
        return this.collections.generate_map(expression)
      case 'comprehension':
        return this.blocks.generate_comprehension(expression)
      case 'record': {
        const values = new Map(
          expression.fields.map((field) => [field.name.name, this.generate(field.value)]),
        )
        return emit_record(this.ir, this.types.get(expression)!, values)
      }
      case 'index':
        return this.collections.generate_index(expression)
      case 'function':
        return this.blocks.generate_closure(expression)
    }
  }

  // A field's value, of a class, a struct or an anonymous struct; the object is released, and
  // the value retained, since every expression yields an owned reference.
  read_field(object: string, type: Type, name: string): string {
    if (type.kind === 'Record') {
      const value = emit_record_field(this.ir, object, type, name)
      emit_release(this.ir, object)
      return value
    }
    const info = this.objects.info(type)
    const field = info.fields.find((field) => field.name.name === name)!
    const pointer = emit_field_pointer(this.ir, object, info, field)
    const value = this.ir.assign(`load ${ir_type(field.type!)}, ptr ${pointer}`)
    if (is_reference_type(field.type!)) emit_retain(this.ir, value)
    emit_release(this.ir, object)
    return value
  }

  // `s.binary` is the string itself, passing on its ownership; `length` borrows its object.
  private generate_property(member: Member): string {
    const object = this.generate(member.object)
    const object_type = this.types.get(member.object)!
    const object_kind = object_type.kind
    if (object_kind === 'Object' || object_kind === 'Record') {
      return this.read_field(object, object_type, member.name.name)
    }
    if (object_kind === 'String') return object
    const length =
      object_kind === 'Binary'
        ? emit_binary_length(this.ir, object)
        : object_kind === 'Map'
          ? emit_map_length(this.ir, object)
          : emit_length(this.ir, object)
    emit_release(this.ir, object)
    return length
  }

  private generate_interpolation(interpolation: Interpolation): string {
    const parts = interpolation.parts.map((part) =>
      typeof part === 'string' ? string_constant(this.ir, part) : this.generate(part),
    )
    return emit_concat(this.ir, parts)
  }

  // Every expression of a reference type yields an owned reference, which its consumer releases.
  release_if_reference(expression: Expression, operand: string): void {
    if (is_reference_type(this.type_at_use(expression))) emit_release(this.ir, operand)
  }

  // Reading a reference from a slot retains it, since every expression yields an owned reference.
  // A local narrowed to its type without nil is read as such.
  private generate_identifier(identifier: Identifier): string {
    const local = this.locals.lookup(identifier.name)
    const symbol = this.function_symbols.get(identifier.name)
    if (local === undefined && symbol !== undefined) {
      return emit_function_closure(this.ir, symbol, this.types.get(identifier)!)
    }
    // The checker allows no other name as a value: a C function can only be called.
    if (local === undefined) throw new Error(`no value for '${identifier.name}'`)
    return this.read_local(local, this.types.get(identifier)!)
  }

  // The local's value, retained if a reference, as the type it has where it is read: without nil
  // where it is narrowed.
  read_local(local: CodegenLocal, type: Type): string {
    const value =
      local.kind === 'value'
        ? local.operand
        : this.ir.assign(`load ${ir_type(local.type)}, ptr ${slot_pointer(this.ir, local)}`)
    if (is_reference_type(local.type)) emit_retain(this.ir, value)
    const is_narrowed = local.type.kind === 'Optional' && type.kind !== 'Optional'
    return is_narrowed ? emit_unwrap(this.ir, value, local.type) : value
  }
  // The message is not released, since the program ends here.
  private generate_throw(throw_expression: Throw): string {
    const message = this.generate(throw_expression.message)
    this.ir.declare('lerta_throw', 'declare void @lerta_throw(ptr) noreturn')
    this.ir.emit(`call void @lerta_throw(ptr ${message})`)
    emit_unreachable(this.ir)
    return 'poison'
  }
}
