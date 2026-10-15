// Run tests: each source is compiled by the compiler (see lerta.ts), for the target of
// `--target` if given (see target.ts), and run, and its output is compared with <name>.out
// (stdout), <name>.err (stderr: a compile error or an uncaught throw) and <name>.warn (compile
// warnings). A missing file means empty output, but at least one must exist. The run must fail
// exactly when <name>.err exists.
// Tests run in parallel, up to the number of cores, and are reported in order;
// each program runs in an empty directory of its own, where it may write files.
// Every test that compiles runs twice, without and with optimization, to catch
// code whose behavior changes when optimized.
//   tests/**/<name>.lerta  expected files next to it; a lib/ directory holds
//                          modules that tests import, which are checked only
//                          through those tests
//   examples/<name>.lerta  only .out, in tests/examples/ to keep examples/ clean
//   tests/bin/<name>.lerta commands that tests run, the same on every platform, unlike those of
//                          the system; they are built first and found on PATH
//   tests/cli/             not run tests, but the files of the CLI checks (see cli/files.ts)
//   tests/**/posix/        tests of what only POSIX systems have, such as signals, which are not
//                          run for Windows
//   tests/**/windows/      tests of what only Windows has, such as drives, which are run only for
//                          Windows
import { execFile } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { availableParallelism, tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { compiler, OUTPUT_LIMIT, root_dir } from './lerta.ts'
import { compare_text, lines } from './expect.ts'
import { run_checks, run_suite, type Check } from './report.ts'
import { parse_target } from './target.ts'
import { NO_WINE_PREFIXES, start_wine_prefixes } from './wine.ts'

const work_dir = mkdtempSync(join(tmpdir(), 'lerta-test-'))

const target = parse_target('run.ts')
const executable_suffix = target.windows ? '.exe' : ''

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
const commands_dir = 'tests/bin'
const cli_dir = 'tests/cli'

// `dir` and its subdirectories, relative to the root, except `excluded` and lib/ directories.
const directory_tree = (dir: string, excluded: string[]): string[] => [
  dir,
  ...readdirSync(join(root_dir, dir))
    .filter((entry) => entry !== 'lib')
    .map((entry) => `${dir}/${entry}`)
    .filter((path) => !excluded.includes(path) && statSync(join(root_dir, path)).isDirectory())
    .flatMap((path) => directory_tree(path, excluded)),
]

const test_dirs = directory_tree('tests', [examples_expected_dir, commands_dir, cli_dir])
const skipped_kind = target.windows ? 'posix' : 'windows'
const skipped_dirs = test_dirs.filter((dir) => dir.split('/').includes(skipped_kind))

const suites: Suite[] = [
  ...test_dirs
    .filter((dir) => !skipped_dirs.includes(dir))
    .map((dir) => ({
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

// Diagnostics are reported as the CLI prints them for a bare file name, so
// that the expected files do not depend on where the test directory is.
const compile_and_run = async (test: TestCase, optimize: boolean): Promise<Outcome> => {
  const source_file = `${test.name}.lerta`
  const name = `${test.label.replaceAll('/', '_')}${optimize ? '_O' : ''}`
  const executable = join(work_dir, `${name}${executable_suffix}`)
  const args = ['build', source_file, '-o', executable, ...(optimize ? ['-O'] : []), ...target.args]
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

// The commands of tests/bin are built next to the tested programs, and `run` finds them on PATH:
// a POSIX program on the PATH given here, and a Windows program under Wine on its Windows PATH,
// to which Wine adds WINEPATH (Z: is the root of the Unix file system).
const command_env = {
  ...process.env,
  PATH: `${work_dir}${delimiter}${process.env.PATH}`,
  WINEPATH: `Z:${work_dir}`,
}

const build_commands = async (): Promise<void> => {
  const cwd = join(root_dir, commands_dir)
  for (const name of names_with_extension(commands_dir, 'lerta')) {
    const executable = join(work_dir, `${name}${executable_suffix}`)
    const args = ['build', `${name}.lerta`, '-o', executable, '-O', ...target.args]
    const { status, failure, stderr } = await run_file(compiler, args, cwd)
    if (status !== 0)
      throw new Error(`the build of ${commands_dir}/${name} failed (${failure}):\n${stderr}`)
  }
}

// Builds a program with and without -O, so that the compiler caches both runtimes before the
// tests start. Otherwise the tests started together would each compile the same runtime, and each
// such compile runs as many clang processes as there are CPUs.
const build_runtimes = async (): Promise<void> => {
  // Not in work_dir itself, which is on the PATH of the tested programs.
  const dir = mkdtempSync(join(work_dir, 'runtime-'))
  const builds = [[], ['-O']].map(async (optimize) => {
    const executable = join(dir, `empty${optimize.join('')}${executable_suffix}`)
    const args = ['build', 'tests/empty.lerta', '-o', executable, ...optimize, ...target.args]
    const { status, failure, stderr } = await run_file(compiler, args, root_dir)
    if (status !== 0) throw new Error(`the build of tests/empty failed (${failure}):\n${stderr}`)
  })
  await Promise.all(builds)
}

const concurrency = availableParallelism()

// Wine runs a Windows program in a prefix of its own, when there are such prefixes (see wine.ts).
let wine_prefixes = NO_WINE_PREFIXES

// Runs a built program, whose exit status tells whether it failed, in a directory of its own, so
// that files it writes do not meet those of the other runs.
const run_program = (path: string): Promise<{ stdout: string; stderr: string; failed: boolean }> =>
  new Promise((resolve, reject) => {
    const cwd = mkdtempSync(join(work_dir, 'run-'))
    const [file, args] = target.windows ? ['wine', [path]] : [path, []]
    const prefix = wine_prefixes.take()
    const env = prefix === undefined ? command_env : { ...command_env, WINEPREFIX: prefix }
    const options = { cwd, env, encoding: 'utf8', maxBuffer: OUTPUT_LIMIT } as const
    execFile(file, args, options, (error, stdout, stderr) => {
      if (prefix !== undefined) wine_prefixes.give_back(prefix)
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

await run_suite(work_dir, async () => {
  await build_runtimes()
  await build_commands()
  for (const dir of skipped_dirs) console.log(`not run for Windows: ${dir}`)
  if (target.windows) wine_prefixes = await start_wine_prefixes(work_dir, concurrency)
  try {
    return await run_checks('run tests', [...stray_checks, ...test_checks], concurrency)
  } finally {
    await wine_prefixes.stop()
  }
})
