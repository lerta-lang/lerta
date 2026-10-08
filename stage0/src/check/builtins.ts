import {
  array_type,
  binary_type,
  bool_type,
  int_type,
  iter_type,
  string_type,
  stringable_type,
  void_type,
  type Type,
} from '../types.ts'

export type Builtin = {
  type: Type
  // The runtime C function to call, chosen by the argument types.
  runtime_symbol: (arg_types: Type[]) => string
}

const print_symbols: Partial<Record<Type['kind'], string>> = {
  String: 'lerta_print_string',
  Int: 'lerta_print_int',
  Bool: 'lerta_print_bool',
  UInt8: 'lerta_print_byte',
}

export const builtins = new Map<string, Builtin>([
  [
    'print',
    {
      type: { kind: 'function', params: [stringable_type], result: void_type },
      runtime_symbol: ([arg_type]) => {
        const symbol = print_symbols[arg_type.kind]
        if (symbol === undefined) throw new Error(`no print for ${arg_type.kind}`)
        return symbol
      },
    },
  ],
])

const method = (params: Type[], result: Type): Type => ({ kind: 'function', params, result })

// The type of a method of a generic builtin type, if it has one. The other builtin types have their
// methods from std/builtins.lerta, as extends.
export const builtin_method = (receiver: Type, name: string): Type | undefined => {
  if (receiver.kind === 'Map') return map_method(receiver.key, name)
  if (receiver.kind === 'Iter') return iter_method(receiver.item, name)
  if (receiver.kind !== 'Array') return undefined
  const { element } = receiver
  switch (name) {
    case 'push':
      return method([element], void_type)
    case 'pop':
      return method([], element)
    case 'join':
      return element.kind === 'String' ? method([string_type], string_type) : undefined
    default:
      return lazy_method(element, name)
  }
}

// `map` is one too, but its result's type depends on its argument's (see ExpressionChecker).
const lazy_method = (item: Type, name: string): Type | undefined => {
  switch (name) {
    case 'filter':
      return method([method([item], bool_type)], iter_type(item))
    case 'take':
      return method([int_type], iter_type(item))
    default:
      return undefined
  }
}

const iter_method = (item: Type, name: string): Type | undefined => {
  switch (name) {
    case 'has_next':
      return method([], bool_type)
    case 'next':
      return method([], item)
    case 'to_array':
      return method([], array_type(item))
    default:
      return lazy_method(item, name)
  }
}

// The type of a property of a builtin type, read without a call, if it has one.
export const builtin_property = (receiver: Type, name: string): Type | undefined => {
  const has_length = ['Array', 'Map', 'Binary'].includes(receiver.kind)
  if (name === 'length' && has_length) return int_type
  if (name === 'binary' && receiver.kind === 'String') return binary_type
  return undefined
}

const map_method = (key: Type, name: string): Type | undefined => {
  switch (name) {
    case 'has':
      return method([key], bool_type)
    case 'remove':
      return method([key], void_type)
    case 'keys':
      return method([], array_type(key))
    default:
      return undefined
  }
}
