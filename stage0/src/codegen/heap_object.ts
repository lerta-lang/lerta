// Objects on the heap with fields: classes, structs and anonymous structs. Each starts with the
// header `{ i64 ref_count, ptr drop }`, then holds its fields in order; its drop function releases
// the references the fields hold.
import { IrBuilder, type IrModule } from './ir_builder.ts'
import { emit_release, ir_type } from './lerta_ir.ts'
import { is_reference_type, type Type } from '../types.ts'

// The two header fields come before the object's own.
const HEADER_FIELDS = 2

// Defines the LLVM struct type `layout` and the drop function `drop`.
export const define_heap_object = (
  module: IrModule,
  layout: string,
  drop: string,
  field_types: Type[],
): void => {
  module.add_type(`${layout} = type { ${['i64', 'ptr', ...field_types.map(ir_type)].join(', ')} }`)
  const ir = new IrBuilder(module)
  for (const [i, type] of field_types.entries()) {
    if (!is_reference_type(type)) continue
    const pointer = emit_heap_field_pointer(ir, layout, '%object', i)
    emit_release(ir, ir.assign(`load ptr, ptr ${pointer}`))
  }
  ir.emit('ret void')
  ir.finish(`void ${drop}(ptr %object)`)
}

export const emit_heap_field_pointer = (
  ir: IrBuilder,
  layout: string,
  object: string,
  index: number,
): string =>
  ir.assign(`getelementptr ${layout}, ptr ${object}, i32 0, i32 ${HEADER_FIELDS + index}`)

// A new object with reference count 1 and uninitialized fields.
export const emit_heap_allocate = (ir: IrBuilder, layout: string, drop: string): string => {
  ir.declare('lerta_alloc', 'declare ptr @lerta_alloc(i64, ptr)')
  const end = ir.assign(`getelementptr ${layout}, ptr null, i32 1`)
  const size = ir.assign(`ptrtoint ptr ${end} to i64`)
  return ir.assign(`call ptr @lerta_alloc(i64 ${size}, ptr ${drop})`)
}
