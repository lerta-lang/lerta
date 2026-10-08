// Calls to runtime C functions whose signatures a module lists by name.
import type { IrBuilder } from './ir_builder.ts'

// `signatures` maps a function's name to its signature, as in `i64 @f(ptr, i64)`. The returned
// function declares and calls one, giving its result, or '' for void.
export const runtime_caller =
  <Name extends string>(signatures: Record<Name, string>) =>
  (ir: IrBuilder, name: Name, args: string): string => {
    const signature = signatures[name]
    ir.declare(name, `declare ${signature}`)
    const [result_type] = signature.split(' ')
    const instruction = `call ${result_type} @${name}(${args})`
    if (result_type === 'void') {
      ir.emit(instruction)
      return ''
    }
    return ir.assign(instruction)
  }
