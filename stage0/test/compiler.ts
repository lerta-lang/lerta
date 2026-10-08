// Compiler checks: the compiler written in Lerta (compiler/), built with stage0, must agree with
// stage0 on every Lerta file of the repository; so far, on the tokens that `dump-tokens` prints, the
// syntax tree that `dump-ast` prints, the checked syntax trees that `dump-checked` prints and the
// LLVM IR that `build --emit-llvm` writes, or the errors and warnings each reports.
import { execFile } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { availableParallelism, tmpdir } from 'node:os'
import { join } from 'node:path'
import { build, OUTPUT_LIMIT } from '../src/build.ts'
import { compare_text, run_checks } from './report.ts'

const root_dir = join(import.meta.dirname, '../..')
const work_dir = mkdtempSync(join(tmpdir(), 'lerta-compiler-'))
const compiler = join(work_dir, 'lerta')
const stage0_main = join(import.meta.dirname, '../src/main.ts')

// Check names show these directories by name, so that they stay short enough for a line.
const shorten_paths = (text: string): string =>
  text.replaceAll(work_dir, '<tmp>').replaceAll(root_dir, '<root>')

const source_dirs = ['compiler', 'examples', 'std', 'tests']
const commands = ['dump-tokens', 'dump-ast', 'dump-checked', 'build']

// The IR that each compiler writes for the check of a file, by its number.
const ir_path = (compiler_name: string, check: number): string =>
  join(work_dir, `${compiler_name}-${check}.ll`)

// `build` only writes the IR. The compiler cannot find the standard modules and the runtime on its
// own yet, so it is told the root that holds std/.
const stage0_args = (command: string, path: string, check: number): string[] =>
  command === 'build' ? [command, path, '--emit-llvm', ir_path('stage0', check)] : [command, path]
const compiler_args = (command: string, path: string, check: number): string[] =>
  command === 'build'
    ? [command, path, '--emit-llvm', ir_path('compiler', check), '--root', root_dir]
    : command === 'dump-checked'
      ? [command, path, '--root', root_dir]
      : [command, path]

// What a build wrote as IR, if it wrote any.
const written_ir = (path: string): string => (existsSync(path) ? readFileSync(path, 'utf8') : '')

// Entry modules that report diagnostics in a module they import, given by other paths than the
// relative ones of the checks above, so that the paths of diagnostics are worked out from each: an
// absolute path, one through `./` or `..`, and one through a symbolic link to their directory.
const module_dir = 'tests/module'
const linked_dir = join(work_dir, 'linked_module')
const path_entries = ['warning_then_error.lerta', 'error_in_import.lerta'].flatMap((file) => [
  join(root_dir, module_dir, file),
  `./${module_dir}/${file}`,
  `${module_dir}/../module/${file}`,
  join(linked_dir, file),
])

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

const compare = async (command: string, path: string, check: number): Promise<string[]> => {
  const [expected, actual] = await Promise.all([
    run(process.execPath, [stage0_main, ...stage0_args(command, path, check)]),
    run(compiler, compiler_args(command, path, check)),
  ])
  const ir_reasons =
    command === 'build'
      ? compare_text(
          'IR',
          written_ir(ir_path('stage0', check)),
          written_ir(ir_path('compiler', check)),
        )
      : []
  const status_reasons =
    expected.status === actual.status
      ? []
      : [`expected exit status ${expected.status}, got ${actual.status}`]
  return [
    ...compare_text('stdout', expected.stdout, actual.stdout),
    ...compare_text('stderr', expected.stderr, actual.stderr),
    ...status_reasons,
    ...ir_reasons,
  ]
}

let failed_count: number
try {
  await build(join(root_dir, 'compiler/main.lerta'), compiler, { optimize: false })
  symlinkSync(join(root_dir, module_dir), linked_dir)
  const loads_program = (command: string) => command === 'dump-checked' || command === 'build'
  const paths_of = (command: string): string[] =>
    loads_program(command)
      ? [...source_dirs.flatMap(lerta_files), ...path_entries]
      : source_dirs.flatMap(lerta_files)
  const checks = commands
    .flatMap((command) => paths_of(command).map((path) => ({ command, path })))
    .map(({ command, path }, check) => ({
      name: `${command} ${shorten_paths(path)}`,
      run: () => compare(command, path, check),
    }))
  failed_count = await run_checks('compiler checks', checks, availableParallelism())
} finally {
  rmSync(work_dir, { recursive: true, force: true })
}
process.exit(failed_count === 0 ? 0 : 1)
