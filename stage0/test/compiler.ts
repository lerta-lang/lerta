// Compiler checks: the compiler written in Lerta (compiler/), built with stage0, must agree with
// stage0 on every Lerta file of the repository; so far, on the tokens that `dump-tokens` prints,
// or the error it reports.
import { execFile } from 'node:child_process'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { availableParallelism, tmpdir } from 'node:os'
import { join } from 'node:path'
import { build, OUTPUT_LIMIT } from '../src/build.ts'
import { compare_text, run_checks } from './report.ts'

const root_dir = join(import.meta.dirname, '../..')
const work_dir = mkdtempSync(join(tmpdir(), 'lerta-compiler-'))
const compiler = join(work_dir, 'lerta')
const stage0_main = join(import.meta.dirname, '../src/main.ts')

const source_dirs = ['compiler', 'examples', 'std', 'tests']

// The Lerta files under `dir`, relative to the root.
const lerta_files = (dir: string): string[] =>
  readdirSync(join(root_dir, dir), { recursive: true, encoding: 'utf8' })
    .filter((path) => path.endsWith('.lerta'))
    .sort()
    .map((path) => `${dir}/${path}`)

type Outcome = { status: number; stdout: string; stderr: string }

// Runs from the root, so that both name the file by the same relative path in diagnostics.
const run = (file: string, args: string[]): Promise<Outcome> =>
  new Promise((resolve) => {
    const options = { cwd: root_dir, encoding: 'utf8', maxBuffer: OUTPUT_LIMIT } as const
    execFile(file, args, options, (error, stdout, stderr) => {
      const status = error === null ? 0 : typeof error.code === 'number' ? error.code : -1
      resolve({ status, stdout, stderr })
    })
  })

const compare = async (path: string): Promise<string[]> => {
  const [expected, actual] = await Promise.all([
    run(process.execPath, [stage0_main, 'dump-tokens', path]),
    run(compiler, ['dump-tokens', path]),
  ])
  const status_reasons =
    expected.status === actual.status
      ? []
      : [`expected exit status ${expected.status}, got ${actual.status}`]
  return [
    ...compare_text('stdout', expected.stdout, actual.stdout),
    ...compare_text('stderr', expected.stderr, actual.stderr),
    ...status_reasons,
  ]
}

let failed_count: number
try {
  await build(join(root_dir, 'compiler/main.lerta'), compiler, { optimize: false })
  const checks = source_dirs.flatMap(lerta_files).map((path) => ({
    name: `dump-tokens ${path}`,
    run: () => compare(path),
  }))
  failed_count = await run_checks('compiler checks', checks, availableParallelism())
} finally {
  rmSync(work_dir, { recursive: true, force: true })
}
process.exit(failed_count === 0 ? 0 : 1)
