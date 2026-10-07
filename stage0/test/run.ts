// Run tests: each source comes with exactly one expected file, <name>.out for
// the program's stdout or <name>.err for the expected compile error.
//   tests/<name>.lerta     expected file next to it
//   examples/<name>.lerta  only .out, in tests/examples/ to keep examples/ clean
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
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

const suites: Suite[] = [
  { source_dir: 'tests', expected_dir: 'tests', extensions: expected_extensions },
  // Examples are living documentation: they must compile and run.
  { source_dir: 'examples', expected_dir: 'tests/examples', extensions: ['out'] },
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

// Returns the program's stdout, or the compile error as the CLI prints it.
const compile_and_run = (test: TestCase): { stdout: string } | { error: string } => {
  const source_file = `${test.name}.lerta`
  const executable = join(work_dir, test.label.replaceAll('/', '_'))
  try {
    build(join(root_dir, test.source_dir, source_file), executable)
  } catch (error) {
    if (!(error instanceof CompileError)) throw error
    return { error: `${error.format(source_file)}\n` }
  }
  return { stdout: execFileSync(executable, { encoding: 'utf8' }) }
}

const run_test = (test: TestCase): boolean => {
  try {
    const expected = new Map(
      test.extensions.flatMap((extension) => {
        const content = expected_output(test, extension)
        return content === undefined ? [] : [[extension, content] as const]
      }),
    )
    if (expected.size !== 1) {
      const candidates = test.extensions.map((extension) => `${test.name}.${extension}`)
      console.error(
        `${test.label}: needs exactly one of ${candidates.join(', ')} in ${test.expected_dir}`,
      )
      return false
    }
    const result = compile_and_run(test)
    if ('error' in result) return result.error === expected.get('err')
    return result.stdout === expected.get('out')
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
