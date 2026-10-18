// The compiler's own leaks: build/stage1, the compiler that the Makefile builds with the debug
// runtime, which reports the objects left at its end (see docs/internals.md#bootstrap), prints
// the IR of each Lerta source of the repository's tests and examples and of each standard module,
// and must report none. The tests run bin/lerta, which is optimized and reports none. For a source
// with errors, the compiler exits with status 1 through `exit`, where the report is only of the
// objects that nothing in use holds, since what is in use then is not released.
import { mkdtempSync, readdirSync, statSync } from 'node:fs'
import { availableParallelism, tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { root_dir, run_file } from './lerta.ts'
import { run_checks, run_suite, type Check } from './report.ts'

const stage1 = join(root_dir, 'build/stage1')
const work_dir = mkdtempSync(join(tmpdir(), 'lerta-leaks-'))

const lerta_files = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) return lerta_files(path)
    return entry.endsWith('.lerta') ? [relative(root_dir, path)] : []
  })

const std_modules = readdirSync(join(root_dir, 'std'))
  .filter((file) => file.endsWith('.lerta'))
  .map((file) => `std:${file.replace(/\.lerta$/, '')}`)

const sources = [
  ...lerta_files(join(root_dir, 'tests')),
  ...lerta_files(join(root_dir, 'examples')),
  ...std_modules,
]

const checks: Check[] = sources.map((source) => ({
  name: source,
  run: async () => {
    const { status, failure, stderr } = await run_file(stage1, ['dump-llvm', source], root_dir)
    // A source with errors ends with exit status 1, and anything else, as a crash, is a failure.
    const ended = status === 0 || status === 1 ? [] : [`ended with ${failure}:`, stderr]
    return [...ended, ...stderr.split('\n').filter((line) => line.startsWith('leak: '))]
  },
}))

await run_suite(work_dir, () => run_checks('compiler leaks', checks, availableParallelism()))
