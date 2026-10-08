// How Lerta values are represented in LLVM IR.
import type { IrBuilder } from './ir_builder.ts'
import { is_reference_type, type Type } from '../types.ts'

export const LERTA_IMMORTAL = '-9223372036854775808'

export const ir_type = (type: Type): string => {
  switch (type.kind) {
    case 'String':
    case 'Binary':
    case 'Array':
    case 'Map':
    case 'Object':
    case 'Union':
    case 'Record':
    case 'function':
      return 'ptr'
    case 'Int':
      return 'i64'
    case 'Bool':
      return 'i1'
    case 'UInt8':
      return 'i8'
    case 'Writer':
      // A Writer is its file descriptor.
      return 'i64'
    case 'Optional':
      // A reference is nil when null; a value carries a flag that tells whether it is there.
      return is_reference_type(type) ? 'ptr' : `{ i1, ${ir_type(type.inner)} }`
    default:
      throw new Error(`no IR type for ${type.kind}`)
  }
}

// A function that never returns is declared as returning nothing.
export const ir_return_type = (type: Type): string =>
  type.kind === 'void' || type.kind === 'never' ? 'void' : ir_type(type)

// Symbols of generated functions; the prefixes keep them apart from the runtime's C symbols.
// A function is named by its module too, since two modules may declare the same name.
export const function_symbol = (module_index: number, name: string): string =>
  `@lerta.fn.${module_index}.${name}`
// The global that holds a top-level value, and its flag (see top_level_codegen.ts).
export const top_level_symbol = (module_index: number, name: string): string =>
  `@lerta.value.${module_index}.${name}`
export const module_init_symbol = (module_index: number): string => `@lerta.module.${module_index}`
// A class or struct is named by its symbol (see Type), which tells apart those of different modules.
const object_symbol = (type: Type): string => {
  if (type.kind !== 'Object') throw new Error('expected a class or struct type')
  return type.symbol
}
export const method_symbol = (type: Type, method: string): string =>
  `@lerta.method.${object_symbol(type)}.${method}`
export const constructor_symbol = (type: Type): string => `@lerta.new.${object_symbol(type)}`
export const drop_symbol = (type: Type): string => `@lerta.drop.${object_symbol(type)}`
// The LLVM struct type of a class or struct: the object header, then the fields in order.
export const object_ir_type = (type: Type): string => `%lerta.object.${object_symbol(type)}`

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
