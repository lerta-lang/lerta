import { int_type, string_type, stringable_type, void_type, type Type } from './types.ts'

export type Builtin = {
  type: Type
  // The runtime C function to call, chosen by the argument types.
  runtime_symbol: (arg_types: Type[]) => string
}

const print_symbols: Partial<Record<Type['kind'], string>> = {
  String: 'lerta_print_string',
  Int: 'lerta_print_int',
  Bool: 'lerta_print_bool',
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

// The type of a method of a builtin type, if it has one.
export const builtin_method = (receiver: Type, name: string): Type | undefined => {
  const is_stringable = ['String', 'Int', 'Bool'].includes(receiver.kind)
  if (name === 'to_string' && is_stringable) return method([], string_type)
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
      return undefined
  }
}

// The type of a property of a builtin type, read without a call, if it has one.
export const builtin_property = (receiver: Type, name: string): Type | undefined =>
  receiver.kind === 'Array' && name === 'length' ? int_type : undefined
