// The length and the items of an array or a Binary, which for loops and their Iters read by index.
import { emit_get, emit_length } from './array_codegen.ts'
import { emit_binary_get, emit_binary_length } from './binary_codegen.ts'
import type { IrBuilder } from './ir_builder.ts'
import { iterable_item, type Type } from '../types.ts'

export const emit_sequence_length = (ir: IrBuilder, sequence: string, type: Type): string =>
  type.kind === 'Binary' ? emit_binary_length(ir, sequence) : emit_length(ir, sequence)

// The item is owned when it is a reference.
export const emit_sequence_get = (
  ir: IrBuilder,
  sequence: string,
  index: string,
  type: Type,
): string =>
  type.kind === 'Binary'
    ? emit_binary_get(ir, sequence, index)
    : emit_get(ir, sequence, index, iterable_item(type)!)
