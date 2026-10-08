// Operations on maps in the generated code, through the runtime (runtime/map.c). Keys and values
// are 8 bytes, as array items are.
import { from_item, to_item } from './array_codegen.ts'
import type { IrBuilder } from './ir_builder.ts'
import { ir_type } from './lerta_ir.ts'
import { runtime_caller } from './runtime_calls.ts'
import { is_reference_type, optional_type, type Type } from '../types.ts'

const call = runtime_caller({
  lerta_map_new: 'ptr @lerta_map_new(i1 zeroext, i1 zeroext)',
  lerta_map_length: 'i64 @lerta_map_length(ptr)',
  lerta_map_get: 'i1 @lerta_map_get(ptr, i64, ptr)',
  lerta_map_set: 'void @lerta_map_set(ptr, i64, i64)',
  lerta_map_remove: 'void @lerta_map_remove(ptr, i64)',
  lerta_map_keys: 'ptr @lerta_map_keys(ptr)',
})

type MapType = Extract<Type, { kind: 'Map' }>

export const emit_map_new = (ir: IrBuilder, type: MapType): string =>
  call(
    ir,
    'lerta_map_new',
    `i1 zeroext ${type.key.kind === 'String'}, i1 zeroext ${is_reference_type(type.value)}`,
  )

export const emit_map_length = (ir: IrBuilder, map: string): string =>
  call(ir, 'lerta_map_length', `ptr ${map}`)

// The value as a V?, owned when it is a reference; a missing reference reads as null, which is nil.
export const emit_map_get = (ir: IrBuilder, map: string, key: string, type: MapType): string => {
  const slot = ir.alloca('i64')
  const found = call(
    ir,
    'lerta_map_get',
    `ptr ${map}, i64 ${to_item(ir, key, type.key)}, ptr ${slot}`,
  )
  const value = from_item(ir, ir.assign(`load i64, ptr ${slot}`), type.value)
  if (is_reference_type(type.value)) return value
  const optional = ir_type(optional_type(type.value))
  const flagged = ir.assign(`insertvalue ${optional} undef, i1 ${found}, 0`)
  return ir.assign(`insertvalue ${optional} ${flagged}, ${ir_type(type.value)} ${value}, 1`)
}

// The map retains the key and the value, which stay owned by the caller.
export const emit_map_set = (
  ir: IrBuilder,
  map: string,
  key: string,
  value: string,
  type: MapType,
): void => {
  const args = `ptr ${map}, i64 ${to_item(ir, key, type.key)}, i64 ${to_item(ir, value, type.value)}`
  call(ir, 'lerta_map_set', args)
}

export const call_map_method = (
  ir: IrBuilder,
  name: string,
  map: string,
  args: string[],
  type: MapType,
): string => {
  const key = () => `ptr ${map}, i64 ${to_item(ir, args[0], type.key)}`
  switch (name) {
    case 'remove':
      return call(ir, 'lerta_map_remove', key())
    case 'keys':
      return call(ir, 'lerta_map_keys', `ptr ${map}`)
    default:
      throw new Error(`no map method ${name}`)
  }
}
