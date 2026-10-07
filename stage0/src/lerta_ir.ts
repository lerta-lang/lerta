// How Lerta values are represented in LLVM IR.
import type { IrBuilder } from './ir_builder.ts'
import { is_reference_type, type Type } from './types.ts'

const LERTA_IMMORTAL = '-9223372036854775808'

export const ir_type = (type: Type): string => {
  switch (type.kind) {
    case 'String':
    case 'Binary':
    case 'Array':
      return 'ptr'
    case 'Int':
      return 'i64'
    case 'Bool':
      return 'i1'
    case 'UInt8':
      return 'i8'
    case 'Optional':
      // A reference is nil when null; a value carries a flag that tells whether it is there.
      return is_reference_type(type) ? 'ptr' : `{ i1, ${ir_type(type.inner)} }`
    default:
      throw new Error(`no IR type for ${type.kind}`)
  }
}

export const ir_return_type = (type: Type): string =>
  type.kind === 'void' ? 'void' : ir_type(type)

// The symbol of a top-level function; the prefix keeps it apart from the runtime's C symbols.
export const function_symbol = (name: string): string => `@lerta.fn.${name}`

// C `bool` and `uint8_t` parameters expect their arguments zero-extended.
export const ir_param_type = (type: Type): string =>
  type.kind === 'Bool' || type.kind === 'UInt8' ? `${ir_type(type)} zeroext` : ir_type(type)

// Bytes other than printable ASCII, '"' and '\' are written as \XX in IR strings.
const ir_string_bytes = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => {
    const is_plain = b >= 0x20 && b <= 0x7e && b !== 0x22 && b !== 0x5c
    return is_plain ? String.fromCharCode(b) : `\\${b.toString(16).toUpperCase().padStart(2, '0')}`
  }).join('')

// An immortal LertaString (see runtime/lerta.h) holding the literal's bytes.
export const string_constant = (ir: IrBuilder, value: string): string => {
  const bytes = new TextEncoder().encode(value)
  const bytes_type = `[${bytes.length} x i8]`
  // The header (reference count and drop function), the length and the bytes.
  const type = `{ i64, ptr, i64, ${bytes_type} }`
  const bytes_init = `${bytes_type} c"${ir_string_bytes(bytes)}"`
  const init = `{ i64 ${LERTA_IMMORTAL}, ptr null, i64 ${bytes.length}, ${bytes_init} }`
  return ir.global('lerta.string', `private unnamed_addr constant ${type} ${init}`)
}

// Reference counting of an object operand (see runtime/memory.c).
export const emit_retain = (ir: IrBuilder, operand: string): void => {
  ir.declare('lerta_retain', 'declare void @lerta_retain(ptr)')
  ir.emit(`call void @lerta_retain(ptr ${operand})`)
}

export const emit_release = (ir: IrBuilder, operand: string): void => {
  ir.declare('lerta_release', 'declare void @lerta_release(ptr)')
  ir.emit(`call void @lerta_release(ptr ${operand})`)
}
