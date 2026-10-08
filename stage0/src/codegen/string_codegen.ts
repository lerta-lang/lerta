// Operations on Strings in the generated code. Operands are owned Strings unless noted.
import type { IrBuilder } from './ir_builder.ts'
import { emit_release } from './lerta_ir.ts'

// A new String holding the parts one after another; the parts are released.
export const emit_concat = (ir: IrBuilder, parts: string[]): string => {
  ir.declare('lerta_string_concat', 'declare ptr @lerta_string_concat(i64, ...)')
  const args = parts.map((part) => `ptr ${part}`).join(', ')
  const result = ir.assign(`call ptr (i64, ...) @lerta_string_concat(i64 ${parts.length}, ${args})`)
  for (const part of parts) emit_release(ir, part)
  return result
}

// Whether two Strings have the same bytes; both are released.
export const emit_equals = (ir: IrBuilder, left: string, right: string): string => {
  ir.declare('lerta_string_equals', 'declare zeroext i1 @lerta_string_equals(ptr, ptr)')
  const result = ir.assign(`call zeroext i1 @lerta_string_equals(ptr ${left}, ptr ${right})`)
  emit_release(ir, left)
  emit_release(ir, right)
  return result
}
