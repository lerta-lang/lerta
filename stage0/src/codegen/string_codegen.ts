// Operations on Strings in the generated code. Operands are owned Strings unless noted.
import type { IrBuilder } from './ir_builder.ts'
import { emit_release, string_constant } from './lerta_ir.ts'
import { int_type, type Type } from '../types.ts'

// An owned String with the text of a Stringable value; a String is passed on as is.
export const emit_to_string = (ir: IrBuilder, operand: string, type: Type): string => {
  switch (type.kind) {
    case 'String':
      return operand
    case 'Int':
      ir.declare('lerta_int_to_string', 'declare ptr @lerta_int_to_string(i64)')
      return ir.assign(`call ptr @lerta_int_to_string(i64 ${operand})`)
    case 'UInt8':
      return emit_to_string(ir, ir.assign(`zext i8 ${operand} to i64`), int_type)
    case 'Bool': {
      const true_text = string_constant(ir, 'true')
      const false_text = string_constant(ir, 'false')
      return ir.assign(`select i1 ${operand}, ptr ${true_text}, ptr ${false_text}`)
    }
    default:
      throw new Error(`no to_string for ${type.kind}`)
  }
}

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

// An Int?, nil unless the String is an integer in decimal.
export const emit_parse_int = (ir: IrBuilder, string: string): string => {
  ir.declare('lerta_string_parse_int', 'declare zeroext i1 @lerta_string_parse_int(ptr, ptr)')
  const slot = ir.alloca('i64')
  const parsed = ir.assign(`call zeroext i1 @lerta_string_parse_int(ptr ${string}, ptr ${slot})`)
  const value = ir.assign(`load i64, ptr ${slot}`)
  const flagged = ir.assign(`insertvalue { i1, i64 } { i1 false, i64 0 }, i1 ${parsed}, 0`)
  return ir.assign(`insertvalue { i1, i64 } ${flagged}, i64 ${value}, 1`)
}
