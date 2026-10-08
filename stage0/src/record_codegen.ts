// Anonymous structs in the generated code: heap objects (see heap_object.ts) with their fields in
// name order. Each structural type has its own LLVM type and drop function, defined once.
import { define_heap_object, emit_heap_allocate, emit_heap_field_pointer } from './heap_object.ts'
import type { IrBuilder } from './ir_builder.ts'
import { emit_retain, ir_type } from './lerta_ir.ts'
import { is_reference_type, type_key, type Type } from './types.ts'

type RecordType = Extract<Type, { kind: 'Record' }>

const record_type_of = (type: Type): RecordType => {
  if (type.kind !== 'Record') throw new Error('expected an anonymous struct type')
  return type
}

// The LLVM struct type of the record type, and its drop function, defined with the first use.
const record_names = (ir: IrBuilder, type: RecordType): { layout: string; drop: string } => {
  const field_types = type.fields.map((field) => field.type)
  const layout = ir.named(`record ${type_key(type)}`, '%lerta.record', (name, module) =>
    define_heap_object(module, name, drop_name(name), field_types),
  )
  return { layout, drop: drop_name(layout) }
}

const drop_name = (layout: string): string => `@${layout.slice(1)}.drop`

// A new anonymous struct, which takes over the values, owned, given by field name.
export const emit_record = (ir: IrBuilder, type: Type, values: Map<string, string>): string => {
  const record_type = record_type_of(type)
  const { layout, drop } = record_names(ir, record_type)
  const record = emit_heap_allocate(ir, layout, drop)
  for (const [i, field] of record_type.fields.entries()) {
    const pointer = emit_heap_field_pointer(ir, layout, record, i)
    ir.emit(`store ${ir_type(field.type)} ${values.get(field.name)!}, ptr ${pointer}`)
  }
  return record
}

// The value of a field, retained if a reference; the record is borrowed.
export const emit_record_field = (
  ir: IrBuilder,
  record: string,
  type: Type,
  name: string,
): string => {
  const record_type = record_type_of(type)
  const { layout } = record_names(ir, record_type)
  const index = record_type.fields.findIndex((field) => field.name === name)
  const field_type = record_type.fields[index].type
  const pointer = emit_heap_field_pointer(ir, layout, record, index)
  const value = ir.assign(`load ${ir_type(field_type)}, ptr ${pointer}`)
  if (is_reference_type(field_type)) emit_retain(ir, value)
  return value
}
