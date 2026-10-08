// Iters in the generated code. An Iter is a heap object (see heap_object.ts) whose first fields are
// the code of its has_next and next, which take the Iter itself, and whether a traversal of it has
// started (LertaIter in runtime/lerta.h); the state of its kind follows. The kinds are an Iter of an
// array's items, of a range's Ints, and those that map, filter or take the items of another Iter,
// which they own; each is generated once per type it depends on.
import { emit_array_new, emit_get, emit_length, emit_push } from './array_codegen.ts'
import { emit_closure_call } from './closure_codegen.ts'
import {
  define_heap_object,
  emit_heap_allocate,
  emit_heap_field_pointer,
  field_ir_type,
  heap_object_type,
  type HeapField,
} from './heap_object.ts'
import { IrBuilder } from './ir_builder.ts'
import { emit_release, ir_type } from './lerta_ir.ts'
import { runtime_caller } from './runtime_calls.ts'
import {
  bool_type,
  int_type,
  is_reference_type,
  iter_type,
  iterable_item,
  type_key,
  type Type,
} from '../types.ts'

const call = runtime_caller({
  lerta_iter_start: 'void @lerta_iter_start(ptr)',
  lerta_throw_iter_ended: 'void @lerta_throw_iter_ended()',
})

// The fields every Iter starts with, and the layout through which those of any Iter are reached.
const PROTOCOL: HeapField[] = ['ptr', 'ptr', 'i1']
const [HAS_NEXT_FIELD, NEXT_FIELD, STARTED_FIELD] = [0, 1, 2]
const PROTOCOL_LAYOUT = heap_object_type(PROTOCOL)

// A kind of Iter: its LLVM struct type, and the fields of its state.
type IterKind = { layout: string; state: HeapField[] }

// The code of a kind: the bodies of has_next, which returns an i1, and of next, which returns the
// item and runs only when has_next is true. They get the Iter as `%iter`.
type IterCode = {
  has_next: (body: IrBuilder, kind: IterKind) => void
  next: (body: IrBuilder, kind: IterKind) => void
}

const symbol_of = (kind: IterKind, part: string): string => `@${kind.layout.slice(1)}.${part}`

// The kind of `key`, defined with its drop function and code the first time it is given. Its next
// does not check for the end: its callers ask has_next first (see emit_checked_next).
const define_kind = (
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
const emit_iter = (ir: IrBuilder, kind: IterKind, state_values: string[]): string => {
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

const load_state = (ir: IrBuilder, kind: IterKind, index: number): string =>
  ir.assign(`load ${field_ir_type(kind.state[index])}, ptr ${state_pointer(ir, kind, index)}`)

const store_state = (ir: IrBuilder, kind: IterKind, index: number, value: string): void =>
  ir.emit(
    `store ${field_ir_type(kind.state[index])} ${value}, ptr ${state_pointer(ir, kind, index)}`,
  )

const protocol_field = (ir: IrBuilder, iter: string, index: number): string =>
  emit_heap_field_pointer(ir, PROTOCOL_LAYOUT, iter, index)

// Whether the Iter, which is borrowed, has a next item.
const emit_has_next = (ir: IrBuilder, iter: string): string => {
  const code = ir.assign(`load ptr, ptr ${protocol_field(ir, iter, HAS_NEXT_FIELD)}`)
  return ir.assign(`call i1 ${code}(ptr ${iter})`)
}

// The next item, owned, of a borrowed Iter whose has_next is true.
const emit_next = (ir: IrBuilder, iter: string, item: Type): string => {
  const code = ir.assign(`load ptr, ptr ${protocol_field(ir, iter, NEXT_FIELD)}`)
  return ir.assign(`call ${ir_type(item)} ${code}(ptr ${iter})`)
}

// The next item, owned, of a borrowed Iter, which code outside the Iters asks for without knowing
// that there is one: past the end, it throws.
const emit_checked_next = (ir: IrBuilder, iter: string, item: Type): string => {
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

// The items of an array, which the Iter holds. The length is read each time, as a for loop reads
// it, so items pushed meanwhile are visited too.
export const emit_array_iter = (ir: IrBuilder, array: string, type: Type): string => {
  const element = iterable_item(type)!
  const kind = define_kind(ir, `array ${type_key(element)}`, [type, int_type], element, {
    has_next: (body, kind) => {
      const length = emit_length(body, load_state(body, kind, 0))
      const index = load_state(body, kind, 1)
      body.emit(`ret i1 ${body.assign(`icmp slt i64 ${index}, ${length}`)}`)
    },
    next: (body, kind) => {
      const index = load_state(body, kind, 1)
      const item = emit_get(body, load_state(body, kind, 0), index, element)
      store_state(body, kind, 1, body.assign(`add nsw i64 ${index}, 1`))
      body.emit(`ret ${ir_type(element)} ${item}`)
    },
  })
  return emit_iter(ir, kind, [array, '0'])
}

// The Ints from start up to, but not including, end.
export const emit_range_iter = (ir: IrBuilder, start: string, end: string): string => {
  const kind = define_kind(ir, 'range', [int_type, int_type], int_type, {
    has_next: (body, kind) => {
      const current = load_state(body, kind, 0)
      const end = load_state(body, kind, 1)
      body.emit(`ret i1 ${body.assign(`icmp slt i64 ${current}, ${end}`)}`)
    },
    // The current Int is below the end, so the next one cannot overflow.
    next: (body, kind) => {
      const current = load_state(body, kind, 0)
      store_state(body, kind, 0, body.assign(`add nsw i64 ${current}, 1`))
      body.emit(`ret i64 ${current}`)
    },
  })
  return emit_iter(ir, kind, [start, end])
}

// The results of a function of one item, a closure of the type, for each item of the source.
const emit_map_iter = (ir: IrBuilder, source: string, mapper: string, type: Type): string => {
  if (type.kind !== 'function') throw new Error('map takes a function')
  const [item] = type.params
  const kind = define_kind(ir, `map ${type_key(type)}`, [iter_type(item), type], type.result, {
    has_next: (body, kind) => body.emit(`ret i1 ${emit_has_next(body, load_state(body, kind, 0))}`),
    next: (body, kind) => {
      const value = emit_next(body, load_state(body, kind, 0), item)
      const result = emit_closure_call(body, load_state(body, kind, 1), type, [value])
      if (is_reference_type(item)) emit_release(body, value)
      body.emit(`ret ${ir_type(type.result)} ${result}`)
    },
  })
  return emit_iter(ir, kind, [source, mapper])
}

// The items of the source for which a function, a closure, gives true. has_next finds the next such
// item and holds it until next takes it; the state is the source, the function, whether an item is
// held, and that item.
const emit_filter_iter = (ir: IrBuilder, source: string, test: string, item: Type): string => {
  const test_type: Type = { kind: 'function', params: [item], result: bool_type }
  const state = [iter_type(item), test_type, bool_type, item]
  const kind = define_kind(ir, `filter ${type_key(item)}`, state, item, {
    has_next: (body, kind) => {
      const search_label = body.fresh_label('filter.search')
      const test_label = body.fresh_label('filter.test')
      const keep_label = body.fresh_label('filter.keep')
      const skip_label = body.fresh_label('filter.skip')
      const found_label = body.fresh_label('filter.found')
      const end_label = body.fresh_label('filter.end')
      body.emit(`br i1 ${load_state(body, kind, 2)}, label %${found_label}, label %${search_label}`)
      body.start_block(search_label)
      const source = load_state(body, kind, 0)
      body.emit(`br i1 ${emit_has_next(body, source)}, label %${test_label}, label %${end_label}`)
      body.start_block(test_label)
      const value = emit_next(body, source, item)
      const keep = emit_closure_call(body, load_state(body, kind, 1), test_type, [value])
      body.emit(`br i1 ${keep}, label %${keep_label}, label %${skip_label}`)
      body.start_block(keep_label)
      store_state(body, kind, 3, value)
      store_state(body, kind, 2, 'true')
      body.emit(`br label %${found_label}`)
      body.start_block(skip_label)
      if (is_reference_type(item)) emit_release(body, value)
      body.emit(`br label %${search_label}`)
      body.start_block(found_label)
      body.emit('ret i1 true')
      body.start_block(end_label)
      body.emit('ret i1 false')
    },
    // The held item passes to the caller; a reference is cleared, so that the drop does not
    // release it.
    next: (body, kind) => {
      store_state(body, kind, 2, 'false')
      const value = load_state(body, kind, 3)
      if (is_reference_type(item)) store_state(body, kind, 3, 'null')
      body.emit(`ret ${ir_type(item)} ${value}`)
    },
  })
  return emit_iter(ir, kind, [source, test, 'false', 'zeroinitializer'])
}

// At most `count` items of the source: none if it is not positive.
const emit_take_iter = (ir: IrBuilder, source: string, count: string, item: Type): string => {
  const kind = define_kind(ir, `take ${type_key(item)}`, [iter_type(item), int_type], item, {
    has_next: (body, kind) => {
      const ask_label = body.fresh_label('take.ask')
      const end_label = body.fresh_label('take.end')
      const remaining = load_state(body, kind, 1)
      const is_positive = body.assign(`icmp sgt i64 ${remaining}, 0`)
      body.emit(`br i1 ${is_positive}, label %${ask_label}, label %${end_label}`)
      body.start_block(ask_label)
      body.emit(`ret i1 ${emit_has_next(body, load_state(body, kind, 0))}`)
      body.start_block(end_label)
      body.emit('ret i1 false')
    },
    next: (body, kind) => {
      const remaining = load_state(body, kind, 1)
      store_state(body, kind, 1, body.assign(`sub nsw i64 ${remaining}, 1`))
      const value = emit_next(body, load_state(body, kind, 0), item)
      body.emit(`ret ${ir_type(item)} ${value}`)
    },
  })
  return emit_iter(ir, kind, [source, count])
}

// An owned array or Iter as an Iter to read from: an Iter of the array's items, or the Iter
// itself, whose traversal starts here.
export const emit_source_iter = (ir: IrBuilder, value: string, type: Type): string => {
  if (type.kind === 'Array') return emit_array_iter(ir, value, type)
  emit_iter_start(ir, value)
  return value
}

const emit_to_array = (ir: IrBuilder, iter: string, item: Type): string => {
  emit_iter_start(ir, iter)
  const array = emit_array_new(ir, item)
  emit_iter_loop(ir, iter, item, (value) => {
    emit_push(ir, array, value, item)
    if (is_reference_type(item)) emit_release(ir, value)
  })
  return array
}

// Calling has_next or next traverses the Iter, so that it cannot be traversed again.
const emit_mark_started = (ir: IrBuilder, iter: string): void =>
  ir.emit(`store i1 true, ptr ${protocol_field(ir, iter, STARTED_FIELD)}`)

export const is_iter_method = (type: Type, name: string): boolean =>
  type.kind === 'Iter' || (type.kind === 'Array' && ['map', 'filter', 'take'].includes(name))

// A method of an Iter, or one of an array that makes an Iter (see is_iter_method). It takes over
// the object and the operands of the arguments, owned: an Iter it makes holds them.
export const call_iter_method = (
  ir: IrBuilder,
  name: string,
  object: string,
  type: Type,
  args: string[],
  arg_types: Type[],
): string => {
  const item = iterable_item(type)!
  const consume = (result: string) => {
    emit_release(ir, object)
    return result
  }
  switch (name) {
    case 'has_next':
      emit_mark_started(ir, object)
      return consume(emit_has_next(ir, object))
    case 'next':
      emit_mark_started(ir, object)
      return consume(emit_checked_next(ir, object, item))
    case 'to_array':
      return consume(emit_to_array(ir, object, item))
    case 'map':
      return emit_map_iter(ir, emit_source_iter(ir, object, type), args[0], arg_types[0])
    case 'filter':
      return emit_filter_iter(ir, emit_source_iter(ir, object, type), args[0], item)
    case 'take':
      return emit_take_iter(ir, emit_source_iter(ir, object, type), args[0], item)
    default:
      throw new Error(`no Iter method ${name}`)
  }
}

// A comprehension's Iter: the items of the source for which the guard, if any, gives true, mapped by
// the element's function. The closures are owned, of functions of the item.
export const emit_comprehension_iter = (
  ir: IrBuilder,
  source: string,
  item: Type,
  guard: string | undefined,
  element: { closure: string; type: Type },
): string => {
  const kept = guard === undefined ? source : emit_filter_iter(ir, source, guard, item)
  return emit_map_iter(ir, kept, element.closure, element.type)
}
