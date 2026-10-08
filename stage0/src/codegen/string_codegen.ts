// Operations on Strings and Binaries in the generated code, through the runtime (runtime/string.c
// and runtime/binary.c).
import type { IrBuilder } from './ir_builder.ts'
import { emit_release } from './lerta_ir.ts'

// A new String holding the parts, which are owned Strings, one after another; the parts are
// released.
export const emit_concat = (ir: IrBuilder, parts: string[]): string => {
  ir.declare('lerta_string_concat', 'declare ptr @lerta_string_concat(i64, ...)')
  const args = parts.map((part) => `ptr ${part}`).join(', ')
  const result = ir.assign(`call ptr (i64, ...) @lerta_string_concat(i64 ${parts.length}, ${args})`)
  for (const part of parts) emit_release(ir, part)
  return result
}

// Whether two owned Strings have the same bytes; both are released.
export const emit_equals = (ir: IrBuilder, left: string, right: string): string => {
  ir.declare('lerta_string_equals', 'declare zeroext i1 @lerta_string_equals(ptr, ptr)')
  const result = ir.assign(`call zeroext i1 @lerta_string_equals(ptr ${left}, ptr ${right})`)
  emit_release(ir, left)
  emit_release(ir, right)
  return result
}

export const emit_binary_length = (ir: IrBuilder, binary: string): string => {
  ir.declare('lerta_binary_length', 'declare i64 @lerta_binary_length(ptr)')
  return ir.assign(`call i64 @lerta_binary_length(ptr ${binary})`)
}

export const emit_binary_get = (ir: IrBuilder, binary: string, index: string): string => {
  ir.declare('lerta_binary_get', 'declare zeroext i8 @lerta_binary_get(ptr, i64)')
  return ir.assign(`call zeroext i8 @lerta_binary_get(ptr ${binary}, i64 ${index})`)
}
