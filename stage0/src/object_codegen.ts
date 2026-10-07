// Classes and structs in the generated code: the layout of an object, its fields and its drop
// function. Constructors and methods are generated like functions (see codegen.ts).
import type { IrBuilder, IrModule } from './ir_builder.ts'
import { drop_symbol, emit_release, ir_type, object_ir_type } from './lerta_ir.ts'
import type { FieldInfo, ObjectInfo } from './object_types.ts'
import { is_reference_type } from './types.ts'

// The two header fields come before the object's own.
const HEADER_FIELDS = 2

const type_name_of = (info: ObjectInfo): string => info.declaration.name.name

export const emit_field_pointer = (
  ir: IrBuilder,
  object: string,
  info: ObjectInfo,
  field: FieldInfo,
): string => {
  const index = info.fields.indexOf(field) + HEADER_FIELDS
  return ir.assign(
    `getelementptr ${object_ir_type(type_name_of(info))}, ptr ${object}, i32 0, i32 ${index}`,
  )
}

// A new object with reference count 1 and uninitialized fields.
export const emit_allocate = (ir: IrBuilder, info: ObjectInfo): string => {
  ir.declare('lerta_alloc', 'declare ptr @lerta_alloc(i64, ptr)')
  const type = object_ir_type(type_name_of(info))
  const end = ir.assign(`getelementptr ${type}, ptr null, i32 1`)
  const size = ir.assign(`ptrtoint ptr ${end} to i64`)
  return ir.assign(`call ptr @lerta_alloc(i64 ${size}, ptr ${drop_symbol(type_name_of(info))})`)
}

// The struct type, and the drop function, which releases the references the fields hold.
export const define_object = (module: IrModule, ir: IrBuilder, info: ObjectInfo): void => {
  const field_types = info.fields.map((field) => ir_type(field.type!))
  const name = type_name_of(info)
  module.add_type(`${object_ir_type(name)} = type { ${['i64', 'ptr', ...field_types].join(', ')} }`)
  for (const field of info.fields) {
    if (!is_reference_type(field.type!)) continue
    const pointer = emit_field_pointer(ir, '%object', info, field)
    emit_release(ir, ir.assign(`load ptr, ptr ${pointer}`))
  }
  ir.emit('ret void')
  ir.finish(`void ${drop_symbol(name)}(ptr %object)`)
}
