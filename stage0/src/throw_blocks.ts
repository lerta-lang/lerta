// Exceptions raised by the generated code itself. Each has one shared block per function that
// throws it, which a check branches to.
import type { IrBuilder } from './ir_builder.ts'
import { string_constant } from './lerta_ir.ts'

const exceptions = {
  overflow: 'integer overflow',
  division_by_zero: 'division by zero',
  unwrapped_nil: 'unwrapped nil',
} as const
export type Exception = keyof typeof exceptions

export class ThrowBlocks {
  private readonly ir: IrBuilder
  private readonly thrown = new Set<Exception>()

  constructor(ir: IrBuilder) {
    this.ir = ir
  }

  throw_if(condition: string, exception: Exception): void {
    this.thrown.add(exception)
    const continue_label = this.ir.fresh_label('continue')
    this.ir.emit(`br i1 ${condition}, label %throw.${exception}, label %${continue_label}`)
    this.ir.start_block(continue_label)
  }

  // Called after the function's final `ret`, so that the main flow never falls into a throw block.
  emit_blocks(): void {
    if (this.thrown.size === 0) return
    this.ir.declare('lerta_throw', 'declare void @lerta_throw(ptr) noreturn')
    for (const exception of this.thrown) {
      const message = string_constant(this.ir, exceptions[exception])
      this.ir.start_block(`throw.${exception}`)
      this.ir.emit(`call void @lerta_throw(ptr ${message})`)
      this.ir.emit('unreachable')
    }
  }
}
