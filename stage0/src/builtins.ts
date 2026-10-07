import { stringable_type, void_type, type Type } from './types.ts'

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
