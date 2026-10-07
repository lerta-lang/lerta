// Integer arithmetic. Int throws on overflow; UInt8 wraps around. Both throw on division by zero.
import type { IrBuilder } from './ir_builder.ts'
import type { ThrowBlocks } from './throw_blocks.ts'
import type { Type } from './types.ts'

const INT_MIN = '-9223372036854775808'

const overflow_intrinsics = { '+': 'sadd', '-': 'ssub', '*': 'smul' } as const

export class CheckedInt {
  private readonly ir: IrBuilder
  private readonly throws: ThrowBlocks

  constructor(ir: IrBuilder, throws: ThrowBlocks) {
    this.ir = ir
    this.throws = throws
  }

  private arithmetic(operator: '+' | '-' | '*', left: string, right: string): string {
    const intrinsic = `llvm.${overflow_intrinsics[operator]}.with.overflow.i64`
    this.ir.declare(intrinsic, `declare { i64, i1 } @${intrinsic}(i64, i64)`)
    const result = this.ir.assign(`call { i64, i1 } @${intrinsic}(i64 ${left}, i64 ${right})`)
    const overflowed = this.ir.assign(`extractvalue { i64, i1 } ${result}, 1`)
    this.throws.throw_if(overflowed, 'overflow')
    return this.ir.assign(`extractvalue { i64, i1 } ${result}, 0`)
  }

  // INT_MIN / -1 overflows; INT_MIN % -1 is rejected too, since LLVM leaves it undefined.
  private division(operator: '/' | '%', left: string, right: string): string {
    const is_zero = this.ir.assign(`icmp eq i64 ${right}, 0`)
    this.throws.throw_if(is_zero, 'division_by_zero')
    const is_min = this.ir.assign(`icmp eq i64 ${left}, ${INT_MIN}`)
    const is_minus_one = this.ir.assign(`icmp eq i64 ${right}, -1`)
    const overflows = this.ir.assign(`and i1 ${is_min}, ${is_minus_one}`)
    this.throws.throw_if(overflows, 'overflow')
    const instruction = operator === '/' ? 'sdiv' : 'srem'
    return this.ir.assign(`${instruction} i64 ${left}, ${right}`)
  }

  // An arithmetic operator applied to two Ints or two UInt8s.
  apply(operator: '+' | '-' | '*' | '/' | '%', left: string, right: string, type: Type): string {
    const is_byte = type.kind === 'UInt8'
    if (operator === '/' || operator === '%') {
      return is_byte
        ? this.byte_division(operator, left, right)
        : this.division(operator, left, right)
    }
    return is_byte
      ? this.byte_arithmetic(operator, left, right)
      : this.arithmetic(operator, left, right)
  }

  private byte_arithmetic(operator: '+' | '-' | '*', left: string, right: string): string {
    const instruction = { '+': 'add', '-': 'sub', '*': 'mul' }[operator]
    return this.ir.assign(`${instruction} i8 ${left}, ${right}`)
  }

  private byte_division(operator: '/' | '%', left: string, right: string): string {
    const is_zero = this.ir.assign(`icmp eq i8 ${right}, 0`)
    this.throws.throw_if(is_zero, 'division_by_zero')
    const instruction = operator === '/' ? 'udiv' : 'urem'
    return this.ir.assign(`${instruction} i8 ${left}, ${right}`)
  }
}
