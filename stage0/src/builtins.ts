import { string_type, void_type, type Type } from './types.ts'

export type Builtin = { type: Type; runtime_symbol: string }

export const builtins = new Map<string, Builtin>([
  [
    'print',
    {
      type: { kind: 'function', params: [string_type], result: void_type },
      runtime_symbol: 'lerta_print',
    },
  ],
])
