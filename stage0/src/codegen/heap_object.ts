// Objects on the heap with fields: classes, structs and anonymous structs. Each starts with the
// header `{ i64 ref_count, ptr drop }`, then holds its fields in order; its drop function releases
// the references the fields hold.
import { IrBuilder, type IrModule } from './ir_builder.ts'
import { emit_release, ir_type } from './lerta_ir.ts'
import { is_reference_type, type Type } from '../types.ts'

// The two header fields come before the object's own.
const HEADER_FIELDS = 2

// A field holds a value of a type, or is given by its IR type when it holds no reference, such as
// a pointer to code.
export type HeapField = Type | string

export const field_ir_type = (field: HeapField): string =>
  typeof field === 'string' ? field : ir_type(field)

// The LLVM struct type of a heap object with the fields: the header, then the fields.
export const heap_object_type = (fields: HeapField[]): string =>
  `{ ${['i64', 'ptr', ...fields.map(field_ir_type)].join(', ')} }`

// Defines the LLVM struct type `layout` and the drop function `drop`, which first runs `deinit`, the
// symbol of a class's deinit method, if there is one.
export const define_heap_object = (
  module: IrModule,
  layout: string,
  drop: string,
  fields: HeapField[],
  deinit?: string,
): void => {
  module.add_type(`${layout} = type ${heap_object_type(fields)}`)
  const ir = new IrBuilder(module)
  if (deinit !== undefined) {
    ir.declare('lerta_run_deinit', 'declare void @lerta_run_deinit(ptr, ptr)')
    ir.emit(`call void @lerta_run_deinit(ptr %object, ptr ${deinit})`)
  }
  for (const [i, field] of fields.entries()) {
    if (typeof field === 'string' || !is_reference_type(field)) continue
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
