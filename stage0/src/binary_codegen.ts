// Operations on Binary values in the generated code, through the runtime (runtime/binary.c).
import type { IrBuilder } from './ir_builder.ts'

export const emit_binary_length = (ir: IrBuilder, binary: string): string => {
  ir.declare('lerta_binary_length', 'declare i64 @lerta_binary_length(ptr)')
  return ir.assign(`call i64 @lerta_binary_length(ptr ${binary})`)
}

export const emit_binary_get = (ir: IrBuilder, binary: string, index: string): string => {
  ir.declare('lerta_binary_get', 'declare zeroext i8 @lerta_binary_get(ptr, i64)')
  return ir.assign(`call zeroext i8 @lerta_binary_get(ptr ${binary}, i64 ${index})`)
}

// A new Binary; `end` is exclusive.
export const emit_binary_slice = (
  ir: IrBuilder,
  binary: string,
  start: string,
  end: string,
): string => {
  ir.declare('lerta_binary_slice', 'declare ptr @lerta_binary_slice(ptr, i64, i64)')
  return ir.assign(`call ptr @lerta_binary_slice(ptr ${binary}, i64 ${start}, i64 ${end})`)
}

// The same object, retained, if its bytes are valid UTF-8; otherwise nil.
export const emit_decode_utf8 = (ir: IrBuilder, binary: string): string => {
  ir.declare('lerta_binary_decode_utf8', 'declare ptr @lerta_binary_decode_utf8(ptr)')
  return ir.assign(`call ptr @lerta_binary_decode_utf8(ptr ${binary})`)
}
