// Function values in the generated code. A function value is a closure: a reference-counted
// object `{ i64 ref_count, ptr drop, ptr code, captured values... }`. Its code takes the closure
// first, then the arguments, which are borrowed, and gives an owned result.
import { IrBuilder } from './ir_builder.ts'
import { emit_release, ir_return_type, ir_type, LERTA_IMMORTAL } from './lerta_ir.ts'
import { emit_unreachable } from './runtime_calls.ts'
import { is_reference_type, type Type } from '../types.ts'

// The code pointer comes after the header.
const CODE_FIELD = 2

const function_type_of = (type: Type): Extract<Type, { kind: 'function' }> => {
  if (type.kind !== 'function') throw new Error('expected a function type')
  return type
}

// The closure of a top-level function, `symbol`: an immortal constant whose code, a thunk defined
// with it, calls the function without the closure.
export const emit_function_closure = (ir: IrBuilder, symbol: string, type: Type): string => {
  const { params, result } = function_type_of(type)
  const thunk = `@lerta.thunk.${symbol.slice(1)}`
  ir.define_once(thunk, (module) => {
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
  return emit_static_closure(ir, thunk)
}

// A closure of `code` that captures nothing: an immortal constant, defined once, which is never
// allocated or freed.
export const emit_static_closure = (ir: IrBuilder, code: string): string => {
  const closure = `@lerta.closure.${code.slice(1)}`
  ir.define_once(closure, (module) => {
    const header = `i64 ${LERTA_IMMORTAL}, ptr null, ptr ${code}`
    module.define_global(closure, `private constant { i64, ptr, ptr } { ${header} }`)
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

// What a closure holds for one capture: a value, or the cell of a captured var (see
// heap_object.ts), which is an owned reference.
export type CapturedSlot = { kind: 'value'; type: Type } | { kind: 'cell' }

export const slot_ir_type = (slot: CapturedSlot): string =>
  slot.kind === 'cell' ? 'ptr' : ir_type(slot.type)

const holds_reference = (slot: CapturedSlot): boolean =>
  slot.kind === 'cell' || is_reference_type(slot.type)

// The IR type of a closure that holds these captures.
const closure_ir_type = (slots: CapturedSlot[]): string =>
  `{ ${['i64', 'ptr', 'ptr', ...slots.map(slot_ir_type)].join(', ')} }`

// The pointer to the closure's `index`th capture.
export const emit_capture_pointer = (
  ir: IrBuilder,
  closure: string,
  slots: CapturedSlot[],
  index: number,
): string =>
  ir.assign(
    `getelementptr ${closure_ir_type(slots)}, ptr ${closure}, i32 0, i32 ${CODE_FIELD + 1 + index}`,
  )

// A new closure of the code `symbol`, which takes over the captures, owned. Its drop function,
// defined with it, releases those that are references.
export const emit_closure = (
  ir: IrBuilder,
  symbol: string,
  captured: { slot: CapturedSlot; operand: string }[],
): string => {
  const slots = captured.map((capture) => capture.slot)
  const drop = slots.some(holds_reference) ? `${symbol}.drop` : 'null'
  if (drop !== 'null') define_closure_drop(ir, drop, slots)
  ir.declare('lerta_alloc', 'declare ptr @lerta_alloc(i64, ptr)')
  const end = ir.assign(`getelementptr ${closure_ir_type(slots)}, ptr null, i32 1`)
  const size = ir.assign(`ptrtoint ptr ${end} to i64`)
  const closure = ir.assign(`call ptr @lerta_alloc(i64 ${size}, ptr ${drop})`)
  const code = ir.assign(
    `getelementptr { i64, ptr, ptr }, ptr ${closure}, i32 0, i32 ${CODE_FIELD}`,
  )
  ir.emit(`store ptr ${symbol}, ptr ${code}`)
  for (const [i, { slot, operand }] of captured.entries()) {
    const pointer = emit_capture_pointer(ir, closure, slots, i)
    ir.emit(`store ${slot_ir_type(slot)} ${operand}, ptr ${pointer}`)
  }
  return closure
}

const define_closure_drop = (ir: IrBuilder, drop: string, slots: CapturedSlot[]): void =>
  ir.define_once(drop, (module) => {
    const body = new IrBuilder(module)
    for (const [i, slot] of slots.entries()) {
      if (!holds_reference(slot)) continue
      const pointer = emit_capture_pointer(body, '%closure', slots, i)
      emit_release(body, body.assign(`load ptr, ptr ${pointer}`))
    }
    body.emit('ret void')
    body.finish(`void ${drop}(ptr %closure)`)
  })
