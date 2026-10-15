// Formatter checks. Each tests/format/<name>.in is copied to <name>.lerta in a directory of its
// own, where `lerta fmt <name>.lerta` must report <name>.report on stderr, failing exactly when
// that is not empty (a missing file means empty); `lerta fmt --fix <name>.lerta` must then succeed
// and leave <name>.formatted (the input itself if it is missing); and `lerta fmt <name>.lerta` must
// then report nothing, as the formatted text is in the style. Then the command line: the paths it
// takes, and what it does with a file that does not parse; and the code of the repository, each
// file a check of its own, as checking a file checks the program that it is the entry of, several
// times over (see removable_annotations), which takes long for one of the compiler.
import { execFile, spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { availableParallelism, tmpdir } from 'node:os'
import { join } from 'node:path'
import { compiler, root_dir } from './lerta.ts'
import { compare_text, expect_status } from './expect.ts'
import { run_checks, run_suite, type Check } from './report.ts'

const work_dir = mkdtempSync(join(tmpdir(), 'lerta-format-'))
const cases_dir = join(root_dir, 'tests/format')

const fmt = (cwd: string, args: string[]) =>
  spawnSync(compiler, ['fmt', ...args], { cwd, encoding: 'utf8' })

const read_or = (path: string, fallback: string) =>
  existsSync(path) ? readFileSync(path, 'utf8') : fallback

const case_check = (name: string): Check => ({
  name: `tests/format/${name}`,
  run: () => {
    const dir = join(work_dir, name)
    mkdirSync(dir)
    const input = readFileSync(join(cases_dir, `${name}.in`), 'utf8')
    const file = `${name}.lerta`
    writeFileSync(join(dir, file), input)
    const expected_report = read_or(join(cases_dir, `${name}.report`), '')
    const checked = fmt(dir, [file])
    const fixed = fmt(dir, ['--fix', file])
    const formatted = readFileSync(join(dir, file), 'utf8')
    const rechecked = fmt(dir, [file])
    return [
      ...compare_text('report', expected_report, checked.stderr),
      ...expect_status(expected_report === '' ? 0 : 1, checked.status),
      ...compare_text('--fix stderr', '', fixed.stderr),
      ...expect_status(0, fixed.status),
      ...compare_text('formatted', read_or(join(cases_dir, `${name}.formatted`), input), formatted),
      ...compare_text('report on the formatted file', '', rechecked.stderr),
      ...expect_status(0, rechecked.status),
    ]
  },
})

// A directory of files, made fresh for a check.
const tree = (name: string, files: Record<string, string>) => {
  const dir = join(work_dir, name)
  mkdirSync(dir, { recursive: true })
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(dir, path, '..'), { recursive: true })
    writeFileSync(join(dir, path), text)
  }
  return dir
}

const unformatted = 'print(1)\n'
// What `lerta fmt` reports on it.
const calls_report =
  'call without parentheses at the start of a statement, with them after `then` or `->` (Calls without parentheses)'

const command_checks: Check[] = [
  {
    name: 'lerta fmt without a path is a usage error',
    run: () => expect_status(2, fmt(work_dir, []).status),
  },
  {
    name: 'lerta fmt reports a path that names nothing, and goes on with the others',
    run: () => {
      const dir = tree('missing', { 'a.lerta': unformatted })
      const result = fmt(dir, ['missing.lerta', 'a.lerta'])
      const expected =
        "'missing.lerta' is not a file or a directory\n" + `a.lerta:1:6: ${calls_report}\n`
      return [
        ...compare_text('stderr', expected, result.stderr),
        ...expect_status(1, result.status),
      ]
    },
  },
  {
    name: 'lerta fmt takes the .lerta files of a directory, in order, but not in . directories',
    run: () => {
      const dir = tree('walk', {
        'src/b.lerta': unformatted,
        'src/a.lerta': unformatted,
        'src/notes.txt': unformatted,
        'src/inner/c.lerta': unformatted,
        'src/.hidden/d.lerta': unformatted,
      })
      const result = fmt(dir, ['src/'])
      const report = (path: string) => `${path}:1:6: ${calls_report}\n`
      const expected = ['src/a.lerta', 'src/b.lerta', 'src/inner/c.lerta'].map(report).join('')
      return [
        ...compare_text('stderr', expected, result.stderr),
        ...expect_status(1, result.status),
      ]
    },
  },
  {
    name: 'lerta fmt reports a file that is not valid UTF-8',
    run: () => {
      const dir = tree('utf8', {})
      writeFileSync(join(dir, 'bad.lerta'), Buffer.from([0x70, 0xff, 0x0a]))
      const result = fmt(dir, ['bad.lerta'])
      const expected = 'bad.lerta: the file is not valid UTF-8\n'
      return [
        ...compare_text('stderr', expected, result.stderr),
        ...expect_status(1, result.status),
      ]
    },
  },
  {
    name: 'lerta fmt --fix writes only the files that change, and fails on one that does not parse',
    run: () => {
      const dir = tree('fix', { 'a.lerta': unformatted, 'b.lerta': 'print 1\n', 'c.lerta': '(\n' })
      const result = fmt(dir, ['--fix', '.'])
      return [
        ...compare_text('stderr', "./c.lerta:1:1: '(' is never closed\n", result.stderr),
        ...expect_status(1, result.status),
        ...compare_text('a.lerta', 'print 1\n', readFileSync(join(dir, 'a.lerta'), 'utf8')),
        ...compare_text('c.lerta', '(\n', readFileSync(join(dir, 'c.lerta'), 'utf8')),
      ]
    },
  },
]

// The code of the repository, as git lists it, the files not added yet included, but in tests/,
// which holds code that is not in the style on purpose. git leaves out the files that it ignores,
// such as build/, which is generated. A file deleted but not yet from git is listed too, and left
// out here.
const repository_files = () => {
  // -z lists the paths as they are, with no quotes.
  const args = ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '*.lerta']
  const listed = spawnSync('git', args, { cwd: root_dir, encoding: 'utf8' })
  return listed.stdout
    .split('\0')
    .filter((file) => file !== '' && !file.startsWith('tests/'))
    .filter((file) => existsSync(join(root_dir, file)))
}

const repository_check = (file: string): Check => ({
  name: `${file} is in the style`,
  run: () =>
    new Promise((resolve) => {
      execFile(compiler, ['fmt', file], { cwd: root_dir }, (error, _stdout, stderr) => {
        const status = error === null ? 0 : typeof error.code === 'number' ? error.code : null
        resolve([...compare_text('stderr', '', stderr), ...expect_status(0, status)])
      })
    }),
})

const names = readdirSync(cases_dir)
  .filter((file) => file.endsWith('.in'))
  .map((file) => file.slice(0, -'.in'.length))
  .sort()

await run_suite(work_dir, () =>
  run_checks(
    'format checks',
    [...names.map(case_check), ...command_checks, ...repository_files().map(repository_check)],
    availableParallelism(),
  ),
)
