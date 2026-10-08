// Cells in the generated code: heap objects (see heap_object.ts) that hold one `var` that function
// literals capture, so that the function that declares it and the literals share it. The scope
// that declares the var owns its cell, and each closure that captures it holds a reference too.
import { define_heap_object, emit_heap_allocate, emit_heap_field_pointer } from './heap_object.ts'
import type { IrBuilder } from './ir_builder.ts'
import { ir_type } from './lerta_ir.ts'
import { is_reference_type, type Type } from '../types.ts'

// The LLVM struct type of a cell of the type, and its drop function, defined with the first use;
// types of the same representation share them.
const cell_layout = (ir: IrBuilder, type: Type): string =>
  ir.named(`cell ${ir_type(type)} ${is_reference_type(type)}`, '%lerta.cell', (name, module) =>
    define_heap_object(module, name, `@${name.slice(1)}.drop`, [type]),
  )

// A new cell, which takes over the value, owned.
export const emit_cell = (ir: IrBuilder, type: Type, value: string): string => {
  const layout = cell_layout(ir, type)
  const cell = emit_heap_allocate(ir, layout, `@${layout.slice(1)}.drop`)
  ir.emit(`store ${ir_type(type)} ${value}, ptr ${emit_cell_pointer(ir, type, cell)}`)
  return cell
}

// The pointer to the cell's value, which a var's reads and writes go through.
export const emit_cell_pointer = (ir: IrBuilder, type: Type, cell: string): string =>
  emit_heap_field_pointer(ir, cell_layout(ir, type), cell, 0)
