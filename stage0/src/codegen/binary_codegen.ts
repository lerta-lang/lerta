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
