// Operations on arrays in the generated code, through the runtime (runtime/array.c). An item is
// 8 bytes: an Int as is, a Bool or a UInt8 zero-extended and a reference as its address.
import type { IrBuilder } from './ir_builder.ts'
import { ir_type } from './lerta_ir.ts'
import { is_reference_type, type Type } from './types.ts'

const runtime_functions = {
  lerta_array_new: 'ptr @lerta_array_new(i1 zeroext)',
  lerta_array_length: 'i64 @lerta_array_length(ptr)',
  lerta_array_get: 'i64 @lerta_array_get(ptr, i64)',
  lerta_array_set: 'void @lerta_array_set(ptr, i64, i64)',
  lerta_array_push: 'void @lerta_array_push(ptr, i64)',
  lerta_array_pop: 'i64 @lerta_array_pop(ptr)',
  lerta_string_join: 'ptr @lerta_string_join(ptr, ptr)',
} as const

type RuntimeFunction = keyof typeof runtime_functions

const call = (ir: IrBuilder, name: RuntimeFunction, args: string): string => {
  const signature = runtime_functions[name]
  ir.declare(name, `declare ${signature}`)
  const [result_type] = signature.split(' ')
  const instruction = `call ${result_type} @${name}(${args})`
  if (result_type === 'void') {
    ir.emit(instruction)
    return ''
  }
  return ir.assign(instruction)
}

export const to_item = (ir: IrBuilder, operand: string, type: Type): string => {
  if (type.kind === 'Int') return operand
  if (type.kind === 'Bool' || type.kind === 'UInt8') {
    return ir.assign(`zext ${ir_type(type)} ${operand} to i64`)
  }
  return ir.assign(`ptrtoint ptr ${operand} to i64`)
}

export const from_item = (ir: IrBuilder, item: string, type: Type): string => {
  if (type.kind === 'Int') return item
  if (type.kind === 'Bool' || type.kind === 'UInt8') {
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

export const emit_join = (ir: IrBuilder, array: string, separator: string): string =>
  call(ir, 'lerta_string_join', `ptr ${array}, ptr ${separator}`)
