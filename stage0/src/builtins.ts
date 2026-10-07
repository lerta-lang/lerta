import { string_type, stringable_type, void_type, type Type } from './types.ts'

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

const to_string: Type = { kind: 'function', params: [], result: string_type }

// Methods of builtin types, by the receiver's type kind.
export const builtin_methods: Partial<Record<Type['kind'], Map<string, Type>>> = {
  String: new Map([['to_string', to_string]]),
  Int: new Map([['to_string', to_string]]),
  Bool: new Map([['to_string', to_string]]),
}
