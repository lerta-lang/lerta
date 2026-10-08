// Generates assignments to names, fields, array items and map values.
import type { Assignment, AssignmentOperator, Index, Member } from '../syntax/ast.ts'
import { emit_get, emit_set } from './array_codegen.ts'
import type { Types } from '../check/shared.ts'
import type { CheckedInt } from './checked_int.ts'
import { slot_pointer, type CodegenLocal, type ExpressionGenerator } from './expression_codegen.ts'
import type { IrBuilder } from './ir_builder.ts'
import { emit_release, ir_type } from './lerta_ir.ts'
import { emit_map_set } from './map_codegen.ts'
import { emit_field_pointer } from './object_codegen.ts'
import type { ObjectTypes } from '../check/object_types.ts'
import type { Scopes } from '../scopes.ts'
import { is_reference_type, type Type } from '../types.ts'

export class AssignmentGenerator {
  private readonly ir: IrBuilder
  private readonly types: Types
  private readonly objects: ObjectTypes
  private readonly locals: Scopes<CodegenLocal>
  private readonly expressions: ExpressionGenerator
  private readonly checked_int: CheckedInt

  constructor(
    ir: IrBuilder,
    types: Types,
    objects: ObjectTypes,
    locals: Scopes<CodegenLocal>,
    expressions: ExpressionGenerator,
    checked_int: CheckedInt,
  ) {
    this.ir = ir
    this.types = types
    this.objects = objects
    this.locals = locals
    this.expressions = expressions
    this.checked_int = checked_int
  }

  // The new value is stored before the old one is released, which is safe even if they are the
  // same object.
  generate_assignment(assignment: Assignment): void {
    const { target } = assignment
    if (target.kind === 'index') return this.generate_index_assignment(assignment, target)
    if (target.kind === 'member') return this.generate_field_assignment(assignment, target)
    const local = this.locals.lookup(target.name)!
    if (local.kind !== 'slot') throw new Error('only slots can be assigned')
    const pointer = slot_pointer(this.ir, local)
    const type = ir_type(local.type)
    const { old, value } = this.load_and_evaluate(assignment, () =>
      this.ir.assign(`load ${type}, ptr ${pointer}`),
    )
    const result = this.combine(assignment.operator, old, value, local.type)
    this.ir.emit(`store ${type} ${result}, ptr ${pointer}`)
    if (is_reference_type(local.type)) emit_release(this.ir, old)
  }

  // The field takes the new value's reference and releases the old one.
  private generate_field_assignment(assignment: Assignment, target: Member): void {
    const object_type = this.types.get(target.object)!
    const info = this.objects.info(object_type)
    const field = info.fields.find((field) => field.name.name === target.name.name)!
    const object = this.expressions.generate(target.object)
    const pointer = emit_field_pointer(this.ir, object, info, field)
    const type = field.type!
    const { old, value } = this.load_and_evaluate(assignment, () =>
      this.ir.assign(`load ${ir_type(type)}, ptr ${pointer}`),
    )
    const result = this.combine(assignment.operator, old, value, type)
    this.ir.emit(`store ${ir_type(type)} ${result}, ptr ${pointer}`)
    if (is_reference_type(type)) emit_release(this.ir, old)
    emit_release(this.ir, object)
  }

  // The array or map retains the new item and releases the old one.
  private generate_index_assignment(assignment: Assignment, target: Index): void {
    const object_type = this.types.get(target.object)!
    if (object_type.kind === 'Map')
      return this.generate_map_assignment(assignment, target, object_type)
    const element = this.types.get(target)!
    const array = this.expressions.generate(target.object)
    const index = this.expressions.generate(target.index)
    const old = assignment.operator === '=' ? '' : emit_get(this.ir, array, index, element)
    const value = this.expressions.generate(assignment.value)
    const result = this.combine(assignment.operator, old, value, element)
    emit_set(this.ir, array, index, result, element)
    if (is_reference_type(element)) emit_release(this.ir, result)
    emit_release(this.ir, array)
  }

  // Only `=` applies to a map value. The key, like an index, is evaluated before the value.
  private generate_map_assignment(
    assignment: Assignment,
    target: Index,
    type: Extract<Type, { kind: 'Map' }>,
  ): void {
    const map = this.expressions.generate(target.object)
    const key = this.expressions.generate(target.index)
    const value = this.expressions.generate(assignment.value)
    emit_map_set(this.ir, map, key, value, type)
    this.expressions.release_if_reference(target.index, key)
    this.expressions.release_if_reference(assignment.value, value)
    emit_release(this.ir, map)
  }

  // For `=`, the value is evaluated before the old one is loaded, since evaluating it may change
  // the target (a method that assigns the same field, for example); releasing a stale old value
  // would then free it twice. For `+=` and so on, the old Int is loaded first, as it is combined.
  private load_and_evaluate(
    assignment: Assignment,
    load: () => string,
  ): { old: string; value: string } {
    if (assignment.operator !== '=') {
      const old = load()
      return { old, value: this.expressions.generate(assignment.value) }
    }
    const value = this.expressions.generate(assignment.value)
    return { old: load(), value }
  }

  // The value to store: the new one for `=`, or the old one combined with it for `+=` and so on.
  private combine(operator: AssignmentOperator, old: string, value: string, type: Type): string {
    if (operator === '=') return value
    return this.checked_int.apply(operator[0] as '+' | '-' | '*' | '/' | '%', old, value, type)
  }
}
