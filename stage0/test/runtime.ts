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

type Outcome = { stderr: string; status: number | null }

const run_main = (name: string, main_body: string, optimize: boolean): Outcome => {
  const source = join(work_dir, `${name}.c`)
  const executable = join(work_dir, name)
  writeFileSync(source, `#include "lerta.h"\nvoid lerta_main(void) {\n${main_body}\n}\n`)
  execFileSync('clang', [
    '-I',
    runtime_dir,
    source,
    ...runtime_clang_args(optimize),
    '-o',
    executable,
  ])
  const run = spawnSync(executable, { encoding: 'utf8' })
  return { stderr: run.stderr, status: run.status }
}

const expect_status = (expected: number, actual: number | null): string[] =>
  expected === actual ? [] : [`expected exit status ${expected}, got ${actual}`]

const leak = '  lerta_alloc(16, NULL);'
const checks: Check[] = [
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
  failed_count = run_checks('runtime checks', checks)
} finally {
  rmSync(work_dir, { recursive: true, force: true })
}
process.exit(failed_count === 0 ? 0 : 1)
