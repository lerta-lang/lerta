// The standard modules, `'std:io'` and `'std:process'`: the names they export, and the runtime C
// functions behind them.
import {
  array_type,
  binary_type,
  int_type,
  never_type,
  string_type,
  void_type,
  writer_type,
  type Type,
} from '../types.ts'

const fn = (params: Type[], result: Type): Type => ({ kind: 'function', params, result })

// A function, or a value that is computed where it is read.
export type StdExport =
  | { kind: 'function'; type: Type; symbol: string }
  | { kind: 'value'; type: Type; read: 'stdout' | 'stderr' | 'argv' }

export const std_modules = new Map<string, Map<string, StdExport>>([
  [
    'std:io',
    new Map<string, StdExport>([
      [
        'read_file',
        { kind: 'function', type: fn([string_type], binary_type), symbol: 'lerta_read_file' },
      ],
      [
        'write_file',
        {
          kind: 'function',
          type: fn([string_type, binary_type], void_type),
          symbol: 'lerta_write_file',
        },
      ],
      ['stdout', { kind: 'value', type: writer_type, read: 'stdout' }],
      ['stderr', { kind: 'value', type: writer_type, read: 'stderr' }],
    ]),
  ],
  [
    'std:process',
    new Map<string, StdExport>([
      ['argv', { kind: 'value', type: array_type(string_type), read: 'argv' }],
      ['exit', { kind: 'function', type: fn([int_type], never_type), symbol: 'lerta_exit' }],
    ]),
  ],
])
