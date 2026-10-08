// The protocol of Iters in the generated code. An Iter is a heap object (see heap_object.ts) whose
// first fields are the code of its has_next and next, which take the Iter itself, and whether a
// traversal of it has started (LertaIter in runtime/lerta.h); the state of its kind follows.
import {
  define_heap_object,
  emit_heap_allocate,
  emit_heap_field_pointer,
  field_ir_type,
  heap_object_type,
  type HeapField,
} from './heap_object.ts'
import { IrBuilder } from './ir_builder.ts'
import { ir_type } from './lerta_ir.ts'
import { runtime_caller } from './runtime_calls.ts'
import type { Type } from '../types.ts'

const call = runtime_caller({
  lerta_iter_start: 'void @lerta_iter_start(ptr)',
  lerta_throw_iter_ended: 'void @lerta_throw_iter_ended()',
})

// The fields every Iter starts with, and the layout through which those of any Iter are reached.
const PROTOCOL: HeapField[] = ['ptr', 'ptr', 'i1']
const [HAS_NEXT_FIELD, NEXT_FIELD, STARTED_FIELD] = [0, 1, 2]
const PROTOCOL_LAYOUT = heap_object_type(PROTOCOL)

// A kind of Iter: its LLVM struct type, and the fields of its state.
export type IterKind = { layout: string; state: HeapField[] }

// The code of a kind: the bodies of has_next, which returns an i1, and of next, which returns the
// item and runs only when has_next is true. They get the Iter as `%iter`.
type IterCode = {
  has_next: (body: IrBuilder, kind: IterKind) => void
  next: (body: IrBuilder, kind: IterKind) => void
}

const symbol_of = (kind: IterKind, part: string): string => `@${kind.layout.slice(1)}.${part}`

// The kind of `key`, defined with its drop function and code the first time it is given. Its next
// does not check for the end: its callers ask has_next first (see emit_checked_next).
export const define_kind = (
  ir: IrBuilder,
  key: string,
  state: HeapField[],
  item: Type,
  code: IterCode,
): IterKind => {
  const layout = ir.named(`iter ${key}`, '%lerta.iter', (layout, module) => {
    const kind = { layout, state }
    define_heap_object(module, layout, symbol_of(kind, 'drop'), [...PROTOCOL, ...state])
    const has_next = new IrBuilder(module)
    code.has_next(has_next, kind)
    has_next.finish(`i1 ${symbol_of(kind, 'has_next')}(ptr %iter)`)
    const next = new IrBuilder(module)
    code.next(next, kind)
    next.finish(`${ir_type(item)} ${symbol_of(kind, 'next')}(ptr %iter)`)
  })
  return { layout, state }
}

const emit_throw_unless = (ir: IrBuilder, condition: string): void => {
  const ended_label = ir.fresh_label('iter.ended')
  const go_label = ir.fresh_label('iter.go')
  ir.emit(`br i1 ${condition}, label %${go_label}, label %${ended_label}`)
  ir.start_block(ended_label)
  call(ir, 'lerta_throw_iter_ended', '')
  ir.emit('unreachable')
  ir.start_block(go_label)
}

// A new Iter of the kind, not started, which takes over the values of its state.
export const emit_iter = (ir: IrBuilder, kind: IterKind, state_values: string[]): string => {
  const iter = emit_heap_allocate(ir, kind.layout, symbol_of(kind, 'drop'))
  const values = [symbol_of(kind, 'has_next'), symbol_of(kind, 'next'), 'false', ...state_values]
  for (const [i, field] of [...PROTOCOL, ...kind.state].entries()) {
    const pointer = emit_heap_field_pointer(ir, kind.layout, iter, i)
    ir.emit(`store ${field_ir_type(field)} ${values[i]}, ptr ${pointer}`)
  }
  return iter
}

const state_pointer = (ir: IrBuilder, kind: IterKind, index: number): string =>
  emit_heap_field_pointer(ir, kind.layout, '%iter', PROTOCOL.length + index)

export const load_state = (ir: IrBuilder, kind: IterKind, index: number): string =>
  ir.assign(`load ${field_ir_type(kind.state[index])}, ptr ${state_pointer(ir, kind, index)}`)

export const store_state = (ir: IrBuilder, kind: IterKind, index: number, value: string): void =>
  ir.emit(
    `store ${field_ir_type(kind.state[index])} ${value}, ptr ${state_pointer(ir, kind, index)}`,
  )

const protocol_field = (ir: IrBuilder, iter: string, index: number): string =>
  emit_heap_field_pointer(ir, PROTOCOL_LAYOUT, iter, index)

// Whether the Iter, which is borrowed, has a next item.
export const emit_has_next = (ir: IrBuilder, iter: string): string => {
  const code = ir.assign(`load ptr, ptr ${protocol_field(ir, iter, HAS_NEXT_FIELD)}`)
  return ir.assign(`call i1 ${code}(ptr ${iter})`)
}

// The next item, owned, of a borrowed Iter whose has_next is true.
export const emit_next = (ir: IrBuilder, iter: string, item: Type): string => {
  const code = ir.assign(`load ptr, ptr ${protocol_field(ir, iter, NEXT_FIELD)}`)
  return ir.assign(`call ${ir_type(item)} ${code}(ptr ${iter})`)
}

// The next item, owned, of a borrowed Iter, which code outside the Iters asks for without knowing
// that there is one: past the end, it throws.
export const emit_checked_next = (ir: IrBuilder, iter: string, item: Type): string => {
  emit_throw_unless(ir, emit_has_next(ir, iter))
  return emit_next(ir, iter, item)
}

// Starts a traversal, which throws if the Iter has started one.
export const emit_iter_start = (ir: IrBuilder, iter: string): void => {
  call(ir, 'lerta_iter_start', `ptr ${iter}`)
}

// Runs `body` for each item, owned, of a borrowed Iter whose traversal has started. `body` gets the
// labels that leave the loop and go on to the next item.
export const emit_iter_loop = (
  ir: IrBuilder,
  iter: string,
  item: Type,
  body: (item: string, exit_label: string, next_label: string) => void,
): void => {
  const header_label = ir.fresh_label('iter.header')
  const body_label = ir.fresh_label('iter.body')
  const exit_label = ir.fresh_label('iter.exit')
  ir.emit(`br label %${header_label}`)
  ir.start_block(header_label)
  ir.emit(`br i1 ${emit_has_next(ir, iter)}, label %${body_label}, label %${exit_label}`)
  ir.start_block(body_label)
  body(emit_next(ir, iter, item), exit_label, header_label)
  ir.emit(`br label %${header_label}`)
  ir.start_block(exit_label)
}

// Calling has_next or next traverses the Iter, so that it cannot be traversed again.
export const emit_mark_started = (ir: IrBuilder, iter: string): void =>
  ir.emit(`store i1 true, ptr ${protocol_field(ir, iter, STARTED_FIELD)}`)
