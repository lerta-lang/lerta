// Objects on the heap with fields: classes and structs, anonymous structs, and cells. Each starts
// with the header `{ i64 ref_count, ptr drop }`, then holds its fields in order; its drop function
// releases the references the fields hold.
import { IrBuilder, type IrModule } from './ir_builder.ts'
import {
  drop_symbol,
  emit_release,
  emit_retain,
  ir_type,
  method_symbol,
  object_ir_type,
} from './lerta_ir.ts'
import type { FieldInfo, ObjectInfo } from '../check/object_types.ts'
import { is_reference_type, type_key, type Type } from '../types.ts'

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

// Classes and structs: named by their types. Constructors and methods are generated like functions
// (see function_codegen.ts).

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
  const deinit = info.has_deinit ? method_symbol(info.type, 'deinit') : undefined
  define_heap_object(module, object_ir_type(info.type), drop_symbol(info.type), field_types, deinit)
}

// An i1: whether the object is of the type. The drop function in the header tells the type, since
// every type has its own.
export const emit_type_test = (ir: IrBuilder, object: string, type: Type): string => {
  const pointer = ir.assign(`getelementptr { i64, ptr }, ptr ${object}, i32 0, i32 1`)
  const drop = ir.assign(`load ptr, ptr ${pointer}`)
  return ir.assign(`icmp eq ptr ${drop}, ${drop_symbol(type)}`)
}

// A value of the IR type, computed by `of_member` for the member of the union that the object is:
// each member but the last is tested in turn.
export const emit_member_dispatch = (
  ir: IrBuilder,
  object: string,
  members: Type[],
  result_type: string,
  of_member: (member: Type) => string,
): string => {
  const done = ir.fresh_label('member.done')
  const incoming = members.map((member, i) => {
    const next = i === members.length - 1 ? undefined : ir.fresh_label('member.next')
    if (next !== undefined) {
      const matched = ir.fresh_label('member.matched')
      ir.emit(`br i1 ${emit_type_test(ir, object, member)}, label %${matched}, label %${next}`)
      ir.start_block(matched)
    }
    const value = of_member(member)
    const block = ir.current_block
    ir.emit(`br label %${done}`)
    if (next !== undefined) ir.start_block(next)
    return `[ ${value}, %${block} ]`
  })
  ir.start_block(done)
  return ir.assign(`phi ${result_type} ${incoming.join(', ')}`)
}

// Anonymous structs: their fields are in name order. Each structural type has its own LLVM type and
// drop function, defined once.

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

// Cells: each holds one `var` that function literals capture, so that the function that declares it
// and the literals share it. The scope that declares the var owns its cell, and each closure that
// captures it holds a reference too.

// The LLVM struct type of a cell of the type, and its drop function, defined with the first use;
// types of the same representation share them.
const cell_layout = (ir: IrBuilder, type: Type): string =>
  ir.named(`cell ${ir_type(type)} ${is_reference_type(type)}`, '%lerta.cell', (name, module) =>
    define_heap_object(module, name, drop_name(name), [type]),
  )

// A new cell, which takes over the value, owned.
export const emit_cell = (ir: IrBuilder, type: Type, value: string): string => {
  const layout = cell_layout(ir, type)
  const cell = emit_heap_allocate(ir, layout, drop_name(layout))
  ir.emit(`store ${ir_type(type)} ${value}, ptr ${emit_cell_pointer(ir, type, cell)}`)
  return cell
}

// The pointer to the cell's value, which a var's reads and writes go through.
export const emit_cell_pointer = (ir: IrBuilder, type: Type, cell: string): string =>
  emit_heap_field_pointer(ir, cell_layout(ir, type), cell, 0)
