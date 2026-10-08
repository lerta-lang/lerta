// Runtime checks that no Lerta program can trigger: a C program stands in for
// the generated code and is linked with the runtime as `build` links it.
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runtime_clang_args } from '../src/build.ts'
import { compare_text, run_checks, type Check } from './report.ts'

const runtime_dir = join(import.meta.dirname, '../../runtime')
const work_dir = mkdtempSync(join(tmpdir(), 'lerta-runtime-'))

type Outcome = { stdout: string; stderr: string; status: number | null }

const run_main = (name: string, main_body: string, optimize: boolean): Outcome => {
  const source = join(work_dir, `${name}.c`)
  const executable = join(work_dir, name)
  const includes = '#include <string.h>\n#include "lerta.h"\n'
  writeFileSync(source, `${includes}void lerta_main(void) {\n${main_body}\n}\n`)
  execFileSync('clang', [
    '-I',
    runtime_dir,
    source,
    ...runtime_clang_args(optimize),
    '-o',
    executable,
  ])
  const run = spawnSync(executable, { encoding: 'utf8' })
  return { stdout: run.stdout, stderr: run.stderr, status: run.status }
}

const expect_status = (expected: number, actual: number | null): string[] =>
  expected === actual ? [] : [`expected exit status ${expected}, got ${actual}`]

const leak = '  lerta_alloc(16, NULL);'
// Prints whether the bytes decode as UTF-8, for each byte sequence.
const decode_each = (sequences: number[][]): string =>
  sequences
    .map((bytes) =>
      [
        '  {',
        `    static const uint8_t bytes[] = {${bytes.join(', ')}};`,
        '    LertaString *s = lerta_alloc((int64_t)(sizeof(LertaString) + sizeof bytes), NULL);',
        '    s->length = sizeof bytes;',
        '    memcpy(s->bytes, bytes, sizeof bytes);',
        '    LertaString *decoded = lerta_binary_decode_utf8(s);',
        '    lerta_print_bool(decoded != NULL);',
        '    lerta_release(decoded);',
        '    lerta_release(s);',
        '  }',
      ].join('\n'),
    )
    .join('\n')

// Valid sequences, then overlong forms, a surrogate, a code point above U+10FFFF, a truncated
// sequence and a lone continuation byte.
const utf8_cases: [number[], boolean][] = [
  [[0xc3, 0xa9], true],
  [[0xf0, 0x9f, 0x98, 0x80], true],
  [[0xc0, 0x80], false],
  [[0xe0, 0x80, 0x80], false],
  [[0xed, 0xa0, 0x80], false],
  [[0xf4, 0x90, 0x80, 0x80], false],
  [[0xe2, 0x82], false],
  [[0x80], false],
]

const checks: Check[] = [
  {
    name: 'decode_utf8 accepts only valid UTF-8',
    run: () => {
      const { stdout, status } = run_main(
        'utf8',
        decode_each(utf8_cases.map(([bytes]) => bytes)),
        false,
      )
      const expected = utf8_cases.map(([, valid]) => `${valid}\n`).join('')
      return [...compare_text('stdout', expected, stdout), ...expect_status(0, status)]
    },
  },
  {
    name: 'the debug runtime reports a leak',
    run: () => {
      const { stderr, status } = run_main('leak_debug', leak, false)
      return [...compare_text('stderr', 'leak: 1 object(s)\n', stderr), ...expect_status(1, status)]
    },
  },
  {
    name: 'the debug runtime accepts released objects',
    run: () => {
      const { stderr, status } = run_main(
        'released',
        '  lerta_release(lerta_alloc(16, NULL));',
        false,
      )
      return [...compare_text('stderr', '', stderr), ...expect_status(0, status)]
    },
  },
  {
    name: 'the optimized runtime does not count objects',
    run: () => {
      const { stderr, status } = run_main('leak_optimized', leak, true)
      return [...compare_text('stderr', '', stderr), ...expect_status(0, status)]
    },
  },
]

let failed_count: number
try {
  failed_count = await run_checks('runtime checks', checks)
} finally {
  rmSync(work_dir, { recursive: true, force: true })
}
process.exit(failed_count === 0 ? 0 : 1)
