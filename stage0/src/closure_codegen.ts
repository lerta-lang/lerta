// Function values in the generated code. A function value is a closure: a reference-counted
// object `{ i64 ref_count, ptr drop, ptr code, captured values... }`. Its code takes the closure
// first, then the arguments, which are borrowed, and gives an owned result.
import type { IrBuilder } from './ir_builder.ts'
import { ir_return_type, ir_type, LERTA_IMMORTAL } from './lerta_ir.ts'
import { emit_unreachable } from './std_codegen.ts'
import type { Type } from './types.ts'

// The code pointer comes after the header.
const CODE_FIELD = 2

const function_type_of = (type: Type): Extract<Type, { kind: 'function' }> => {
  if (type.kind !== 'function') throw new Error('expected a function type')
  return type
}

// The closure of a top-level function, `symbol`: an immortal constant, defined once, whose code
// calls the function without the closure.
export const emit_function_closure = (ir: IrBuilder, symbol: string, type: Type): string => {
  const { params, result } = function_type_of(type)
  const name = symbol.slice(1)
  const closure = `@lerta.closure.${name}`
  const thunk = `@lerta.thunk.${name}`
  ir.define_once(closure, (module) => {
    const header = `i64 ${LERTA_IMMORTAL}, ptr null, ptr ${thunk}`
    module.define_global(closure, `private constant { i64, ptr, ptr } { ${header} }`)
    const typed_params = params.map((param, i) => `${ir_type(param)} %p${i}`)
    const args = typed_params.join(', ')
    const return_type = ir_return_type(result)
    const call = `call ${return_type} ${symbol}(${args})`
    const body =
      return_type === 'void'
        ? [`  ${call}`, result.kind === 'never' ? '  unreachable' : '  ret void']
        : [`  %result = ${call}`, `  ret ${return_type} %result`]
    const signature = `${return_type} ${thunk}(${['ptr %closure', ...typed_params].join(', ')})`
    module.add_function([`define private ${signature} {`, ...body, '}'].join('\n'))
  })
  return closure
}

// Calls a closure with the operands of its arguments; the closure is borrowed.
export const emit_closure_call = (
  ir: IrBuilder,
  closure: string,
  type: Type,
  args: string[],
): string => {
  const { params, result } = function_type_of(type)
  const pointer = ir.assign(
    `getelementptr { i64, ptr, ptr }, ptr ${closure}, i32 0, i32 ${CODE_FIELD}`,
  )
  const code = ir.assign(`load ptr, ptr ${pointer}`)
  const typed_args = args.map((arg, i) => `${ir_type(params[i])} ${arg}`)
  const return_type = ir_return_type(result)
  const call = `call ${return_type} ${code}(${['ptr ' + closure, ...typed_args].join(', ')})`
  if (return_type !== 'void') return ir.assign(call)
  ir.emit(call)
  if (result.kind !== 'never') return ''
  emit_unreachable(ir)
  return 'poison'
}
