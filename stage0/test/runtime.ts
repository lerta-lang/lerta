// Runtime checks that no Lerta program can trigger: a C program stands in for
// the generated code and is linked with the runtime as `build` links it.
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runtime_clang_args } from '../src/build.ts'

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

const leak = '  lerta_alloc(16);'
const checks: { name: string; passes: () => boolean }[] = [
  {
    name: 'the debug runtime reports a leak',
    passes: () => {
      const { stderr, status } = run_main('leak_debug', leak, false)
      return stderr === 'leak: 1 object(s)\n' && status === 1
    },
  },
  {
    name: 'the debug runtime accepts released objects',
    passes: () => {
      const { stderr, status } = run_main('released', '  lerta_release(lerta_alloc(16));', false)
      return stderr === '' && status === 0
    },
  },
  {
    name: 'the optimized runtime does not count objects',
    passes: () => {
      const { stderr, status } = run_main('leak_optimized', leak, true)
      return stderr === '' && status === 0
    },
  },
]

let failed: typeof checks
try {
  failed = checks.filter((check) => !check.passes())
} finally {
  rmSync(work_dir, { recursive: true, force: true })
}
for (const { name } of failed) console.error(`FAIL runtime: ${name}`)
console.log(`${checks.length - failed.length}/${checks.length} runtime checks passed`)
process.exit(failed.length === 0 ? 0 : 1)
