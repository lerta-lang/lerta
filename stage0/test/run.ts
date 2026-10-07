// Run tests: each source is compiled and run, and its output is compared with
// <name>.out (stdout), <name>.err (stderr: a compile error or an uncaught
// throw) and <name>.warn (compile warnings). A missing file means empty output,
// but at least one must exist. The run must fail exactly when <name>.err exists.
// Every test runs twice, without and with optimization, to catch code whose
// behavior changes when optimized. The unoptimized build goes through
// --emit-llvm, so every test also checks that the emitted IR builds.
//   tests/**/<name>.lerta  expected files next to it
//   examples/<name>.lerta  only .out, in tests/examples/ to keep examples/ clean
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build } from '../src/build.ts'
import { CompileError } from '../src/errors.ts'

const root_dir = join(import.meta.dirname, '../..')
const work_dir = mkdtempSync(join(tmpdir(), 'lerta-test-'))

type TestCase = {
  // Shown in failures, such as `examples/hello`.
  label: string
  name: string
  source_dir: string
  expected_dir: string
  extensions: string[]
}

type Suite = Omit<TestCase, 'label' | 'name'>

const expected_extensions = ['out', 'err', 'warn']

const examples_expected_dir = 'tests/examples'

// `dir` and its subdirectories, relative to the root, except `excluded`.
const directory_tree = (dir: string, excluded: string): string[] => [
  dir,
  ...readdirSync(join(root_dir, dir))
    .map((entry) => `${dir}/${entry}`)
    .filter((path) => path !== excluded && statSync(join(root_dir, path)).isDirectory())
    .flatMap((path) => directory_tree(path, excluded)),
]

const suites: Suite[] = [
  ...directory_tree('tests', examples_expected_dir).map((dir) => ({
    source_dir: dir,
    expected_dir: dir,
    extensions: expected_extensions,
  })),
  // Examples are living documentation: they must compile and run.
  { source_dir: 'examples', expected_dir: examples_expected_dir, extensions: ['out'] },
]

const names_with_extension = (dir: string, extension: string): string[] =>
  readdirSync(join(root_dir, dir))
    .filter((file) => file.endsWith(`.${extension}`))
    .map((file) => file.slice(0, -`.${extension}`.length))

const collect = (suite: Suite): TestCase[] =>
  names_with_extension(suite.source_dir, 'lerta').map((name) => ({
    label: `${suite.source_dir}/${name}`,
    name,
    ...suite,
  }))

// Files in the expected directory that no test would read, such as the
// expected output of a deleted source.
const stray_files = (suite: Suite): string[] => {
  const sources = new Set(names_with_extension(suite.source_dir, 'lerta'))
  const expected_files = expected_extensions.flatMap((extension) =>
    names_with_extension(suite.expected_dir, extension)
      .filter((name) => !sources.has(name) || !suite.extensions.includes(extension))
      .map((name) => `${suite.expected_dir}/${name}.${extension}`),
  )
  const misplaced_sources =
    suite.expected_dir === suite.source_dir
      ? []
      : names_with_extension(suite.expected_dir, 'lerta').map(
          (name) => `${suite.expected_dir}/${name}.lerta`,
        )
  return [...expected_files, ...misplaced_sources]
}

const expected_output = (test: TestCase, extension: string): string | undefined => {
  const path = join(root_dir, test.expected_dir, `${test.name}.${extension}`)
  return existsSync(path) ? readFileSync(path, 'utf8') : undefined
}

type Outcome = { stdout: string; stderr: string; warnings: string; failed: boolean }

const lines = (texts: string[]): string => texts.map((text) => `${text}\n`).join('')

// Diagnostics are reported as the CLI prints them for a bare file name, so
// that the expected files do not depend on where the test directory is.
const compile_and_run = (test: TestCase, optimize: boolean): Outcome => {
  const source_file = `${test.name}.lerta`
  const executable = join(work_dir, `${test.label.replaceAll('/', '_')}${optimize ? '_O' : ''}`)
  const options = optimize ? { optimize } : { optimize, llvm_path: `${executable}.ll` }
  let warnings: string
  try {
    const source_path = join(root_dir, test.source_dir, source_file)
    const compile_warnings = build(source_path, executable, options)
    if (options.llvm_path !== undefined && !existsSync(options.llvm_path)) {
      throw new Error(`--emit-llvm did not leave ${options.llvm_path}`)
    }
    warnings = lines(compile_warnings.map((warning) => warning.format(source_file)))
  } catch (error) {
    if (!(error instanceof CompileError)) throw error
    return {
      stdout: '',
      stderr: lines([error.format(source_file)]),
      warnings: lines(error.warnings.map((warning) => warning.format(source_file))),
      failed: true,
    }
  }
  const run = spawnSync(executable, { encoding: 'utf8' })
  if (run.error !== undefined) throw run.error
  return { stdout: run.stdout, stderr: run.stderr, warnings, failed: run.status !== 0 }
}

const run_test = (test: TestCase, optimize: boolean): boolean => {
  try {
    const expected = new Map(
      test.extensions.flatMap((extension) => {
        const content = expected_output(test, extension)
        return content === undefined ? [] : [[extension, content] as const]
      }),
    )
    if (expected.size === 0) {
      const candidates = test.extensions.map((extension) => `${test.name}.${extension}`)
      console.error(`${test.label}: needs ${candidates.join(' or ')} in ${test.expected_dir}`)
      return false
    }
    const outcome = compile_and_run(test, optimize)
    return (
      outcome.stdout === (expected.get('out') ?? '') &&
      outcome.stderr === (expected.get('err') ?? '') &&
      outcome.warnings === (expected.get('warn') ?? '') &&
      outcome.failed === expected.has('err')
    )
  } catch (error) {
    console.error(error)
    return false
  }
}

const strays = suites.flatMap(stray_files)
for (const file of strays) console.error(`stray file, not read by any test: ${file}`)

const runs = suites
  .flatMap(collect)
  .flatMap((test) => [false, true].map((optimize) => ({ test, optimize })))
let failed: typeof runs
try {
  failed = runs.filter(({ test, optimize }) => !run_test(test, optimize))
} finally {
  rmSync(work_dir, { recursive: true, force: true })
}

// The command line itself: each invocation and its expected exit status.
const cli_work_dir = mkdtempSync(join(tmpdir(), 'lerta-cli-'))
const hello = join(root_dir, 'examples/hello.lerta')
const exe = join(cli_work_dir, 'hello')
const hello_output = readFileSync(join(root_dir, 'tests/examples/hello.out'), 'utf8')
type CliCase = { args: string[]; status: number; produced?: () => boolean }
const cli_cases: CliCase[] = [
  {
    args: ['build', hello, '-o', `${exe}_O`, '-O', '--emit-llvm', `${exe}_O.ll`],
    status: 0,
    produced: () =>
      spawnSync(`${exe}_O`, { encoding: 'utf8' }).stdout === hello_output &&
      existsSync(`${exe}_O.ll`),
  },
  { args: ['build', join(root_dir, 'tests/name/undefined.lerta'), '-o', exe], status: 1 },
  { args: ['build'], status: 2 },
  { args: ['run', hello, '-o', exe], status: 2 },
  { args: ['build', hello, '-o', exe, '-o', exe], status: 2 },
  { args: ['build', hello, '-o', exe, '-O', '-O'], status: 2 },
  { args: ['build', hello, '-o', '-O'], status: 2 },
  { args: ['build', hello, '-o', exe, '--emit-llvm'], status: 2 },
  { args: ['build', hello, hello, '-o', exe], status: 2 },
  { args: ['build', hello, '-o', exe, '--unknown'], status: 2 },
]
const main_path = join(import.meta.dirname, '../src/main.ts')
const cli_succeeds = ({ args, status, produced }: CliCase): boolean =>
  spawnSync(process.execPath, [main_path, ...args], { stdio: 'ignore' }).status === status &&
  (produced?.() ?? true)
let failed_cli: CliCase[]
try {
  failed_cli = cli_cases.filter((cli_case) => !cli_succeeds(cli_case))
} finally {
  rmSync(cli_work_dir, { recursive: true, force: true })
}

const failures = [
  ...failed.map(({ test, optimize }) => `${test.label}${optimize ? ' (-O)' : ''}`),
  ...failed_cli.map(({ args }) => `lerta ${args.join(' ')}`),
]
const total = runs.length + cli_cases.length
for (const failure of failures) console.error(`FAIL ${failure}`)
console.log(`${total - failures.length}/${total} passed, ${strays.length} stray file(s)`)
process.exit(failures.length === 0 && strays.length === 0 ? 0 : 1)
