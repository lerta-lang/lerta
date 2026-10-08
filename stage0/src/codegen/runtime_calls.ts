// Calls to runtime C functions: those that externs declare, and those that a module lists by name.
import type { IrBuilder } from './ir_builder.ts'
import { ir_c_return_type, ir_param_type } from './lerta_ir.ts'
import type { Type } from '../types.ts'

// Calls a runtime function; one that never returns ends the block, code after it is unreachable,
// and its value, which never comes, is poison.
export const emit_runtime_call = (
  ir: IrBuilder,
  symbol: string,
  type: Type,
  args: { type: Type; operand: string }[],
): string => {
  if (type.kind !== 'function') throw new Error('a runtime function has a function type')
  const params = type.params.map(ir_param_type).join(', ')
  const result = ir_c_return_type(type.result)
  const attributes = type.result.kind === 'never' ? ' noreturn' : ''
  ir.declare(symbol, `declare ${result} @${symbol}(${params})${attributes}`)
  const arg_list = args.map((arg, i) => `${ir_param_type(type.params[i])} ${arg.operand}`)
  const call = `call ${result} @${symbol}(${arg_list.join(', ')})`
  if (result !== 'void') return ir.assign(call)
  ir.emit(call)
  if (type.result.kind !== 'never') return ''
  emit_unreachable(ir)
  return 'poison'
}

// Ends the current block after something that does not return, and starts a block for any code
// that follows, which is unreachable.
export const emit_unreachable = (ir: IrBuilder): void => {
  ir.emit('unreachable')
  ir.start_block(ir.fresh_label('unreachable'))
}

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
