// Run tests: each source is compiled by the compiler written in Lerta, which stage0 builds first,
// and run, and its output is compared with <name>.out (stdout), <name>.err (stderr: a compile error
// or an uncaught throw) and <name>.warn (compile warnings). A missing file means empty output,
// but at least one must exist. The run must fail exactly when <name>.err exists.
// Tests run in parallel, up to the number of cores, and are reported in order;
// each program runs in an empty directory of its own, where it may write files.
// Every test that compiles runs twice, without and with optimization, to catch
// code whose behavior changes when optimized. The unoptimized build goes through
// --emit-llvm, so every test also checks that the emitted IR builds.
//   tests/**/<name>.lerta  expected files next to it; a lib/ directory holds
//                          modules that tests import, which are checked only
//                          through those tests
//   examples/<name>.lerta  only .out, in tests/examples/ to keep examples/ clean
import { execFile } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { availableParallelism, tmpdir } from 'node:os'
import { join } from 'node:path'
import { build, OUTPUT_LIMIT } from '../src/build.ts'
import { compare_text, run_checks, type Check } from './report.ts'

const root_dir = join(import.meta.dirname, '../..')
const work_dir = mkdtempSync(join(tmpdir(), 'lerta-test-'))
// The compiler written in Lerta, which stage0 builds first; the tests check it.
const compiler = join(work_dir, 'lerta')

// `--target <triple>` builds the tests for another target than the host, such as i686-linux-gnu for
// the 32-bit programs that an x86-64 host can run.
const target_args = ((): string[] => {
  const [option, triple, ...rest] = process.argv.slice(2)
  if (option === undefined) return []
  if (option !== '--target' || triple === undefined || rest.length > 0) {
    console.error('usage: node test/run.ts [--target <triple>]')
    process.exit(2)
  }
  return ['--target', triple]
})()

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

// `dir` and its subdirectories, relative to the root, except `excluded` and lib/ directories.
const directory_tree = (dir: string, excluded: string): string[] => [
  dir,
  ...readdirSync(join(root_dir, dir))
    .filter((entry) => entry !== 'lib')
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

type Outcome = {
  stdout: string
  stderr: string
  warnings: string
  failed: boolean
  compile_error: boolean
}

const lines = (texts: string[]): string => texts.map((text) => `${text}\n`).join('')

// Diagnostics are reported as the CLI prints them for a bare file name, so
// that the expected files do not depend on where the test directory is.
const compile_and_run = async (test: TestCase, optimize: boolean): Promise<Outcome> => {
  const source_file = `${test.name}.lerta`
  const executable = join(work_dir, `${test.label.replaceAll('/', '_')}${optimize ? '_O' : ''}`)
  // Not `<executable>.ll`, which the compiler writes when --emit-llvm is not given.
  const llvm_path = `${executable}.emitted.ll`
  const options = optimize ? ['-O'] : ['--emit-llvm', llvm_path]
  const args = [
    'build',
    source_file,
    '-o',
    executable,
    ...options,
    ...target_args,
    '--root',
    root_dir,
  ]
  const cwd = join(root_dir, test.source_dir)
  const { status, failure, stderr } = await run_file(compiler, args, cwd)
  const diagnostics = stderr.split('\n').filter((line) => line !== '')
  const warnings = diagnostics.filter((line) => WARNING.test(line))
  const others = diagnostics.filter((line) => !WARNING.test(line))
  const is_compile_error = status === 1 && others.length === 1 && DIAGNOSTIC.test(others[0])
  if (is_compile_error) {
    return {
      stdout: '',
      stderr: lines(others),
      warnings: lines(warnings),
      failed: true,
      compile_error: true,
    }
  }
  if (status !== 0 || others.length > 0)
    throw new Error(`the build failed (${failure}):\n${stderr}`)
  if (!optimize && !existsSync(llvm_path)) throw new Error(`--emit-llvm did not leave ${llvm_path}`)
  const run = await run_program(executable)
  return { ...run, warnings: lines(warnings), compile_error: false }
}

// A diagnostic names its place first; anything else, such as clang's messages, is a failure of the
// build itself.
const DIAGNOSTIC = /^.+?:\d+:\d+: /
const WARNING = /^.+?:\d+:\d+: warning: /

// Runs a file to its end, whatever its exit status; `failure` tells how it ended, for messages.
const run_file = (
  file: string,
  args: string[],
  cwd: string,
): Promise<{ status: number | null; failure: string; stderr: string }> =>
  new Promise((resolve) => {
    const options = { cwd, encoding: 'utf8', maxBuffer: OUTPUT_LIMIT } as const
    execFile(file, args, options, (error, _stdout, stderr) => {
      const status = error === null ? 0 : typeof error.code === 'number' ? error.code : null
      const failure =
        error === null ? 'exit status 0' : status === null ? error.message : `exit status ${status}`
      resolve({ status, failure, stderr })
    })
  })

// Runs a built program, whose exit status tells whether it failed, in a directory of its own, so
// that files it writes do not meet those of the other runs.
const run_program = (path: string): Promise<{ stdout: string; stderr: string; failed: boolean }> =>
  new Promise((resolve, reject) => {
    const cwd = mkdtempSync(join(work_dir, 'run-'))
    execFile(path, { cwd, encoding: 'utf8', maxBuffer: OUTPUT_LIMIT }, (error, stdout, stderr) => {
      // An exit status, or a signal such as a panic's abort, is a failed run; an error with a code
      // of its own, such as too much output, or none, is a failure to run it.
      const ended =
        error === null ||
        typeof error.code === 'number' ||
        (error.code == null && error.signal !== null)
      if (!ended) reject(error)
      else resolve({ stdout, stderr, failed: error !== null })
    })
  })

const run_test = async (test: TestCase, optimize: boolean): Promise<string[]> => {
  const expected = new Map(
    test.extensions.flatMap((extension) => {
      const content = expected_output(test, extension)
      return content === undefined ? [] : [[extension, content] as const]
    }),
  )
  if (expected.size === 0) {
    const candidates = test.extensions.map((extension) => `${test.name}.${extension}`)
    return [`needs ${candidates.join(' or ')} in ${test.expected_dir}`]
  }
  const pending = compile_and_run(test, optimize)
  if (!optimize) unoptimized_runs.set(test, pending)
  const outcome = await pending
  const expects_failure = expected.has('err')
  const status_reasons =
    outcome.failed === expects_failure
      ? []
      : [`expected the run to ${expects_failure ? 'fail' : 'succeed'}, but it did not`]
  return [
    ...compare_text('stdout', expected.get('out') ?? '', outcome.stdout),
    ...compare_text('stderr', expected.get('err') ?? '', outcome.stderr),
    ...compare_text('warnings', expected.get('warn') ?? '', outcome.warnings),
    ...status_reasons,
  ]
}

const strays = suites.flatMap(stray_files)

// A compile error happens before any optimization, so a test that fails to compile
// without -O is not repeated with it: the -O check waits for the unoptimized one.
const unoptimized_runs = new Map<TestCase, Promise<Outcome>>()

// A stray file fails the run as a check of its own, so the summary lists it.
const stray_checks: Check[] = strays.map((file) => ({
  name: file,
  run: () => ['stray file: no test reads it'],
}))

const test_checks: Check[] = suites.flatMap(collect).flatMap((test) => [
  { name: test.label, run: () => run_test(test, false) },
  {
    name: `${test.label} (-O)`,
    // The time is counted from the end of the wait.
    wait: () => unoptimized_runs.get(test)?.catch(() => undefined),
    run: async () => {
      const unoptimized = await unoptimized_runs.get(test)
      return unoptimized?.compile_error ? undefined : run_test(test, true)
    },
  },
])

let failed_count: number
try {
  // Optimized, as it runs for every test; the bootstrap check runs it unoptimized, checking leaks.
  await build(join(root_dir, 'compiler/main.lerta'), compiler, { optimize: true })
  failed_count = await run_checks(
    'run tests',
    [...stray_checks, ...test_checks],
    availableParallelism(),
  )
} finally {
  rmSync(work_dir, { recursive: true, force: true })
}
process.exit(failed_count === 0 ? 0 : 1)
