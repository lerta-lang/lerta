// The methods and properties that the compiler gives the builtin types: the operations on their
// representation that the runtime or the generated code performs. The others, and the builtin
// functions, such as print, are written in Lerta, in std/builtins.lerta.
import {
  array_type,
  binary_type,
  bool_type,
  int_type,
  iter_type,
  void_type,
  type Type,
} from '../types.ts'

const method = (params: Type[], result: Type): Type => ({ kind: 'function', params, result })

// The type of a method of a generic builtin type, if it has one.
export const builtin_method = (receiver: Type, name: string): Type | undefined => {
  switch (receiver.kind) {
    case 'Array':
      return array_method(receiver.element, name)
    case 'Map':
      return map_method(receiver.key, name)
    case 'Iter':
      return iter_method(receiver.item, name)
    default:
      return undefined
  }
}

const array_method = (element: Type, name: string): Type | undefined => {
  switch (name) {
    case 'push':
      return method([element], void_type)
    case 'pop':
      return method([], element)
    default:
      return take_method(element, name)
  }
}

const iter_method = (item: Type, name: string): Type | undefined => {
  switch (name) {
    case 'has_next':
      return method([], bool_type)
    case 'next':
      return method([], item)
    default:
      return take_method(item, name)
  }
}

// `take` stops reading its source after the items it gives, which an Iter written in Lerta, a
// comprehension, cannot.
const take_method = (item: Type, name: string): Type | undefined =>
  name === 'take' ? method([int_type], iter_type(item)) : undefined

const map_method = (key: Type, name: string): Type | undefined => {
  switch (name) {
    case 'remove':
      return method([key], void_type)
    case 'keys':
      return method([], array_type(key))
    default:
      return undefined
  }
}

// The type of a property of a builtin type, read without a call, if it has one.
export const builtin_property = (receiver: Type, name: string): Type | undefined => {
  const has_length = ['Array', 'Map', 'Binary'].includes(receiver.kind)
  if (name === 'length' && has_length) return int_type
  if (name === 'binary' && receiver.kind === 'String') return binary_type
  return undefined
}
