// The kinds of Iter in the generated code (see iter_protocol.ts): an Iter of the items of an array
// or a Binary, of a range's Ints, and those that map, filter or take the items of another Iter,
// which they own; each is generated once per type it depends on. Also the methods of Iters.
import { emit_closure_call } from './closure_codegen.ts'
import {
  define_kind,
  emit_checked_next,
  emit_has_next,
  emit_iter,
  emit_iter_start,
  emit_mark_started,
  emit_next,
  load_state,
  store_state,
} from './iter_protocol.ts'
import type { IrBuilder } from './ir_builder.ts'
import { emit_release, ir_type } from './lerta_ir.ts'
import { emit_get, emit_length } from './array_codegen.ts'
import { emit_binary_get, emit_binary_length } from './string_codegen.ts'
import {
  bool_type,
  int_type,
  is_reference_type,
  iter_type,
  iterable_item,
  type_key,
  type Type,
} from '../types.ts'

// The length and the items of an array or a Binary, which for loops and their Iters read by index.
export const emit_sequence_length = (ir: IrBuilder, sequence: string, type: Type): string =>
  type.kind === 'Binary' ? emit_binary_length(ir, sequence) : emit_length(ir, sequence)

// The item is owned when it is a reference.
export const emit_sequence_get = (
  ir: IrBuilder,
  sequence: string,
  index: string,
  type: Type,
): string =>
  type.kind === 'Binary'
    ? emit_binary_get(ir, sequence, index)
    : emit_get(ir, sequence, index, iterable_item(type)!)

// The items of an array or a Binary, which the Iter holds. The length is read each time, as a for
// loop reads it, so items pushed to an array meanwhile are visited too.
const emit_sequence_iter = (ir: IrBuilder, sequence: string, type: Type): string => {
  const element = iterable_item(type)!
  const kind = define_kind(ir, `sequence ${type_key(type)}`, [type, int_type], element, {
    has_next: (body, kind) => {
      const length = emit_sequence_length(body, load_state(body, kind, 0), type)
      const index = load_state(body, kind, 1)
      body.emit(`ret i1 ${body.assign(`icmp slt i64 ${index}, ${length}`)}`)
    },
    next: (body, kind) => {
      const index = load_state(body, kind, 1)
      const item = emit_sequence_get(body, load_state(body, kind, 0), index, type)
      store_state(body, kind, 1, body.assign(`add nsw i64 ${index}, 1`))
      body.emit(`ret ${ir_type(element)} ${item}`)
    },
  })
  return emit_iter(ir, kind, [sequence, '0'])
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

// An owned array, Binary or Iter as an Iter to read from: an Iter of the array's or the Binary's
// items, or the Iter itself, whose traversal starts here.
export const emit_source_iter = (ir: IrBuilder, value: string, type: Type): string => {
  if (type.kind === 'Array' || type.kind === 'Binary') return emit_sequence_iter(ir, value, type)
  emit_iter_start(ir, value)
  return value
}

export const is_iter_method = (type: Type, name: string): boolean =>
  type.kind === 'Iter' || (type.kind === 'Array' && name === 'take')

// A method of an Iter, or one of an array that makes an Iter (see is_iter_method). It takes over
// the object and the operands of the arguments, owned: an Iter it makes holds them.
export const call_iter_method = (
  ir: IrBuilder,
  name: string,
  object: string,
  type: Type,
  args: string[],
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
