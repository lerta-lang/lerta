// Optional values in the generated code. An optional reference is a pointer that is null for nil;
// an optional Int, Byte or Bool is a `{ i1, T }` whose flag tells whether the value is there.
import type { IrBuilder } from './ir_builder.ts'
import { ir_type } from './lerta_ir.ts'
import { is_reference_type, optional_type, type Type } from '../types.ts'

// The IR constant for nil of the optional type.
export const nil_constant = (type: Type): string =>
  is_reference_type(type) ? 'null' : `{ i1 false, ${ir_type(inner_of(type))} zeroinitializer }`

// A value of the inner type, made optional.
export const emit_wrap = (ir: IrBuilder, operand: string, inner: Type): string => {
  if (is_reference_type(inner)) return operand
  const type = ir_type(optional_type(inner))
  return ir.assign(
    `insertvalue ${type} { i1 true, ${ir_type(inner)} zeroinitializer }, ${ir_type(inner)} ${operand}, 1`,
  )
}

// An i1 that is true when the optional value is not nil.
export const emit_is_present = (ir: IrBuilder, operand: string, type: Type): string =>
  is_reference_type(type)
    ? ir.assign(`icmp ne ptr ${operand}, null`)
    : ir.assign(`extractvalue ${ir_type(type)} ${operand}, 0`)

// The value without nil, which must not be nil.
export const emit_unwrap = (ir: IrBuilder, operand: string, type: Type): string =>
  is_reference_type(type) ? operand : ir.assign(`extractvalue ${ir_type(type)} ${operand}, 1`)

const inner_of = (type: Type): Type => {
  if (type.kind !== 'Optional') throw new Error('expected an optional type')
  return type.inner
}
