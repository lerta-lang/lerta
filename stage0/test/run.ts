// Run tests: each source is compiled and run, and its output is compared with
// <name>.out (stdout), <name>.err (stderr: a compile error or an uncaught
// throw) and <name>.warn (compile warnings). A missing file means empty output,
// but at least one must exist. The run must fail exactly when <name>.err exists.
// Every test that compiles runs twice, without and with optimization, to catch
// code whose behavior changes when optimized. The unoptimized build goes through
// --emit-llvm, so every test also checks that the emitted IR builds.
//   tests/**/<name>.lerta  expected files next to it; a lib/ directory holds
//                          modules that tests import, which are checked only
//                          through those tests
//   examples/<name>.lerta  only .out, in tests/examples/ to keep examples/ clean
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build } from '../src/build.ts'
import { CompileError } from '../src/errors.ts'
import { compare_text, run_checks, type Check } from './report.ts'

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
      compile_error: true,
    }
  }
  const run = spawnSync(executable, { encoding: 'utf8' })
  if (run.error !== undefined) throw run.error
  const failed = run.status !== 0
  return { stdout: run.stdout, stderr: run.stderr, warnings, failed, compile_error: false }
}

const run_test = (test: TestCase, optimize: boolean): string[] => {
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
  const outcome = compile_and_run(test, optimize)
  if (outcome.compile_error) failed_to_compile.add(test)
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
// without -O is not repeated with it. This relies on each test's unoptimized check
// running, and recording its compile error here, before its -O check.
const failed_to_compile = new Set<TestCase>()

// A stray file fails the run as a check of its own, so the summary lists it.
const stray_checks: Check[] = strays.map((file) => ({
  name: file,
  run: () => ['stray file: no test reads it'],
}))

const test_checks: Check[] = suites.flatMap(collect).flatMap((test) =>
  [false, true].map((optimize) => ({
    name: `${test.label}${optimize ? ' (-O)' : ''}`,
    run: () => (optimize && failed_to_compile.has(test) ? undefined : run_test(test, optimize)),
  })),
)
let failed_count: number
try {
  failed_count = run_checks('run tests', [...stray_checks, ...test_checks])
} finally {
  rmSync(work_dir, { recursive: true, force: true })
}
process.exit(failed_count === 0 ? 0 : 1)
