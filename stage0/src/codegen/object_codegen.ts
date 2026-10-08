// Classes and structs in the generated code: heap objects (see heap_object.ts) named by their
// types. Constructors and methods are generated like functions (see codegen.ts).
import { define_heap_object, emit_heap_allocate, emit_heap_field_pointer } from './heap_object.ts'
import type { IrBuilder, IrModule } from './ir_builder.ts'
import { drop_symbol, object_ir_type } from './lerta_ir.ts'
import type { FieldInfo, ObjectInfo } from '../check/object_types.ts'
import type { Type } from '../types.ts'

export const emit_field_pointer = (
  ir: IrBuilder,
  object: string,
  info: ObjectInfo,
  field: FieldInfo,
): string =>
  emit_heap_field_pointer(ir, object_ir_type(info.type), object, info.fields.indexOf(field))

export const emit_allocate = (ir: IrBuilder, info: ObjectInfo): string =>
  emit_heap_allocate(ir, object_ir_type(info.type), drop_symbol(info.type))

export const define_object = (module: IrModule, info: ObjectInfo): void => {
  const field_types = info.fields.map((field) => field.type!)
  define_heap_object(module, object_ir_type(info.type), drop_symbol(info.type), field_types)
}

// An i1: whether the object is of the type. The drop function in the header tells the type, since
// every type has its own.
export const emit_type_test = (ir: IrBuilder, object: string, type: Type): string => {
  const pointer = ir.assign(`getelementptr { i64, ptr }, ptr ${object}, i32 0, i32 1`)
  const drop = ir.assign(`load ptr, ptr ${pointer}`)
  return ir.assign(`icmp eq ptr ${drop}, ${drop_symbol(type)}`)
}
