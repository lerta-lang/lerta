// Operations on arrays in the generated code, through the runtime (runtime/array.c). An item is
// 8 bytes: an Int as is, a Bool or a Byte zero-extended and a reference as its address.
import type { IrBuilder } from './ir_builder.ts'
import { ir_type } from './lerta_ir.ts'
import { runtime_caller } from './runtime_calls.ts'
import { is_reference_type, type Type } from '../types.ts'

const call = runtime_caller({
  lerta_array_new: 'ptr @lerta_array_new(i1 zeroext)',
  lerta_array_length: 'i64 @lerta_array_length(ptr)',
  lerta_array_get: 'i64 @lerta_array_get(ptr, i64)',
  lerta_array_set: 'void @lerta_array_set(ptr, i64, i64)',
  lerta_array_push: 'void @lerta_array_push(ptr, i64)',
  lerta_array_pop: 'i64 @lerta_array_pop(ptr)',
})

export const to_item = (ir: IrBuilder, operand: string, type: Type): string => {
  // An Int is already 8 bytes.
  if (type.kind === 'Int') return operand
  if (type.kind === 'Bool' || type.kind === 'Byte') {
    return ir.assign(`zext ${ir_type(type)} ${operand} to i64`)
  }
  return ir.assign(`ptrtoint ptr ${operand} to i64`)
}

export const from_item = (ir: IrBuilder, item: string, type: Type): string => {
  if (type.kind === 'Int') return item
  if (type.kind === 'Bool' || type.kind === 'Byte') {
    return ir.assign(`trunc i64 ${item} to ${ir_type(type)}`)
  }
  return ir.assign(`inttoptr i64 ${item} to ptr`)
}

export const emit_array_new = (ir: IrBuilder, element: Type): string =>
  call(ir, 'lerta_array_new', `i1 zeroext ${is_reference_type(element)}`)

export const emit_length = (ir: IrBuilder, array: string): string =>
  call(ir, 'lerta_array_length', `ptr ${array}`)

// The item is owned when it is a reference.
export const emit_get = (ir: IrBuilder, array: string, index: string, element: Type): string =>
  from_item(ir, call(ir, 'lerta_array_get', `ptr ${array}, i64 ${index}`), element)

// The array retains the item, which stays owned by the caller.
export const emit_set = (
  ir: IrBuilder,
  array: string,
  index: string,
  value: string,
  element: Type,
): void => {
  call(ir, 'lerta_array_set', `ptr ${array}, i64 ${index}, i64 ${to_item(ir, value, element)}`)
}

export const emit_push = (ir: IrBuilder, array: string, value: string, element: Type): void => {
  call(ir, 'lerta_array_push', `ptr ${array}, i64 ${to_item(ir, value, element)}`)
}

// The item is owned when it is a reference.
export const emit_pop = (ir: IrBuilder, array: string, element: Type): string =>
  from_item(ir, call(ir, 'lerta_array_pop', `ptr ${array}`), element)

export const call_array_method = (
  ir: IrBuilder,
  name: string,
  array: string,
  element: Type,
  args: string[],
): string => {
  switch (name) {
    case 'push':
      emit_push(ir, array, args[0], element)
      return ''
    case 'pop':
      return emit_pop(ir, array, element)
    default:
      throw new Error(`no array method ${name}`)
  }
}
