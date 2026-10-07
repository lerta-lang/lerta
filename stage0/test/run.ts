// Run tests: each source is compiled and run, and its output is compared with
// <name>.out (stdout) and <name>.err (stderr: a compile error or an uncaught
// throw). A missing file means empty output, but at least one must exist.
// The run must fail exactly when <name>.err exists.
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

const expected_extensions = ['out', 'err']

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

type Outcome = { stdout: string; stderr: string; failed: boolean }

// A compile error is reported as the CLI prints it for a bare file name, so
// that the expected .err does not depend on where the test directory is.
const compile_and_run = (test: TestCase): Outcome => {
  const source_file = `${test.name}.lerta`
  const executable = join(work_dir, test.label.replaceAll('/', '_'))
  try {
    build(join(root_dir, test.source_dir, source_file), executable)
  } catch (error) {
    if (!(error instanceof CompileError)) throw error
    return { stdout: '', stderr: `${error.format(source_file)}\n`, failed: true }
  }
  const run = spawnSync(executable, { encoding: 'utf8' })
  if (run.error !== undefined) throw run.error
  return { stdout: run.stdout, stderr: run.stderr, failed: run.status !== 0 }
}

const run_test = (test: TestCase): boolean => {
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
    const outcome = compile_and_run(test)
    return (
      outcome.stdout === (expected.get('out') ?? '') &&
      outcome.stderr === (expected.get('err') ?? '') &&
      outcome.failed === expected.has('err')
    )
  } catch (error) {
    console.error(error)
    return false
  }
}

const strays = suites.flatMap(stray_files)
for (const file of strays) console.error(`stray file, not read by any test: ${file}`)

const tests = suites.flatMap(collect)
let failed: TestCase[]
try {
  failed = tests.filter((test) => !run_test(test))
} finally {
  rmSync(work_dir, { recursive: true, force: true })
}

for (const test of failed) console.error(`FAIL ${test.label}`)
console.log(
  `${tests.length - failed.length}/${tests.length} passed, ${strays.length} stray file(s)`,
)
process.exit(failed.length === 0 && strays.length === 0 ? 0 : 1)
