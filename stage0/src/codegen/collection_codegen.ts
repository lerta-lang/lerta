// Arrays and maps in the generated code: their literals, and indexing (of a Binary too).
import type { ArrayLiteral, Index, MapLiteral } from '../syntax/ast.ts'
import { emit_array_new, emit_get, emit_push } from './array_codegen.ts'
import { emit_binary_get } from './binary_codegen.ts'
import type { Types } from '../check/checker.ts'
import type { ExpressionGenerator } from './expression_codegen.ts'
import type { IrBuilder } from './ir_builder.ts'
import { emit_release } from './lerta_ir.ts'
import { emit_map_get, emit_map_new, emit_map_set } from './map_codegen.ts'

export class CollectionGenerator {
  private readonly expressions: ExpressionGenerator
  private readonly ir: IrBuilder
  private readonly types: Types

  constructor(expressions: ExpressionGenerator, ir: IrBuilder, types: Types) {
    this.expressions = expressions
    this.ir = ir
    this.types = types
  }

  // Each item is pushed, so the array retains it; the item's own reference is then released.
  generate_array(array: ArrayLiteral): string {
    const type = this.types.get(array)!
    if (type.kind !== 'Array') throw new Error('an array literal has an array type')
    const result = emit_array_new(this.ir, type.element)
    for (const element of array.elements) {
      const value = this.expressions.generate(element)
      emit_push(this.ir, result, value, type.element)
      this.expressions.release_if_reference(element, value)
    }
    return result
  }

  // Each entry is set, so the map retains its key and value, whose own references are then
  // released.
  generate_map(map: MapLiteral): string {
    const type = this.types.get(map)!
    if (type.kind !== 'Map') throw new Error('a map literal has a map type')
    const result = emit_map_new(this.ir, type)
    for (const entry of map.entries) {
      const key = this.expressions.generate(entry.key)
      const value = this.expressions.generate(entry.value)
      emit_map_set(this.ir, result, key, value, type)
      this.expressions.release_if_reference(entry.key, key)
      this.expressions.release_if_reference(entry.value, value)
    }
    return result
  }

  generate_index(index: Index): string {
    const object = this.expressions.generate(index.object)
    const object_type = this.types.get(index.object)!
    const position = this.expressions.generate(index.index)
    const item =
      object_type.kind === 'Binary'
        ? emit_binary_get(this.ir, object, position)
        : object_type.kind === 'Map'
          ? emit_map_get(this.ir, object, position, object_type)
          : emit_get(this.ir, object, position, this.types.get(index)!)
    this.expressions.release_if_reference(index.index, position)
    emit_release(this.ir, object)
    return item
  }
}
