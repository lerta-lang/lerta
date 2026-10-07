// Int arithmetic that throws on overflow and division by zero.
import type { IrBuilder } from './ir_builder.ts'
import { string_constant } from './lerta_ir.ts'

const INT_MIN = '-9223372036854775808'

const overflow_intrinsics = { '+': 'sadd', '-': 'ssub', '*': 'smul' } as const

// Exceptions raised by the generated code itself; each has one shared block that throws it.
const exceptions = {
  overflow: 'integer overflow',
  division_by_zero: 'division by zero',
} as const
type Exception = keyof typeof exceptions

export class CheckedInt {
  private readonly ir: IrBuilder
  private readonly thrown = new Set<Exception>()

  constructor(ir: IrBuilder) {
    this.ir = ir
  }

  arithmetic(operator: '+' | '-' | '*', left: string, right: string): string {
    const intrinsic = `llvm.${overflow_intrinsics[operator]}.with.overflow.i64`
    this.ir.declare(intrinsic, `declare { i64, i1 } @${intrinsic}(i64, i64)`)
    const result = this.ir.assign(`call { i64, i1 } @${intrinsic}(i64 ${left}, i64 ${right})`)
    const overflowed = this.ir.assign(`extractvalue { i64, i1 } ${result}, 1`)
    this.throw_if(overflowed, 'overflow')
    return this.ir.assign(`extractvalue { i64, i1 } ${result}, 0`)
  }

  // INT_MIN / -1 overflows; INT_MIN % -1 is rejected too, since LLVM leaves it undefined.
  division(operator: '/' | '%', left: string, right: string): string {
    const is_zero = this.ir.assign(`icmp eq i64 ${right}, 0`)
    this.throw_if(is_zero, 'division_by_zero')
    const is_min = this.ir.assign(`icmp eq i64 ${left}, ${INT_MIN}`)
    const is_minus_one = this.ir.assign(`icmp eq i64 ${right}, -1`)
    const overflows = this.ir.assign(`and i1 ${is_min}, ${is_minus_one}`)
    this.throw_if(overflows, 'overflow')
    const instruction = operator === '/' ? 'sdiv' : 'srem'
    return this.ir.assign(`${instruction} i64 ${left}, ${right}`)
  }

  // Called after the function's final `ret`, so that the main flow never falls into a throw block.
  emit_throw_blocks(): void {
    if (this.thrown.size === 0) return
    this.ir.declare('lerta_throw', 'declare void @lerta_throw(ptr) noreturn')
    for (const exception of this.thrown) {
      const message = string_constant(this.ir, exceptions[exception])
      this.ir.start_block(`throw.${exception}`)
      this.ir.emit(`call void @lerta_throw(ptr ${message})`)
      this.ir.emit('unreachable')
    }
  }

  private throw_if(condition: string, exception: Exception): void {
    this.thrown.add(exception)
    const continue_label = this.ir.fresh_label('continue')
    this.ir.emit(`br i1 ${condition}, label %throw.${exception}, label %${continue_label}`)
    this.ir.start_block(continue_label)
  }
}
