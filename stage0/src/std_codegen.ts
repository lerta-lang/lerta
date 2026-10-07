// The standard modules in the generated code (see std_modules.ts and runtime/process.c, file.c).
import type { IrBuilder } from './ir_builder.ts'
import { ir_param_type, ir_return_type } from './lerta_ir.ts'
import type { StdExport } from './std_modules.ts'
import type { Type } from './types.ts'

const STDOUT_FD = '1'
const STDERR_FD = '2'

// The value of an imported name such as `stdout` or `argv`; `argv` is a new array each time.
export const emit_std_value = (
  ir: IrBuilder,
  read: Extract<StdExport, { kind: 'value' }>['read'],
): string => {
  if (read === 'stdout') return STDOUT_FD
  if (read === 'stderr') return STDERR_FD
  ir.declare('lerta_argv', 'declare ptr @lerta_argv()')
  return ir.assign('call ptr @lerta_argv()')
}

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
  const result = ir_return_type(type.result)
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

export const emit_writer_method = (
  ir: IrBuilder,
  name: string,
  writer: string,
  args: string[],
): void => {
  if (name === 'flush') {
    ir.declare('lerta_writer_flush', 'declare void @lerta_writer_flush(i64)')
    ir.emit(`call void @lerta_writer_flush(i64 ${writer})`)
    return
  }
  // A Binary has the same representation as a String, so both are written the same way.
  ir.declare('lerta_writer_write', 'declare void @lerta_writer_write(i64, ptr)')
  ir.emit(`call void @lerta_writer_write(i64 ${writer}, ptr ${args[0]})`)
}
