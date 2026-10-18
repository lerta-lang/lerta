// Formatter checks. Each tests/format/<name>.in is copied to <name>.lerta in a directory of its
// own, where `lerta fmt <name>.lerta` must report <name>.report on stderr, failing exactly when
// that is not empty (a missing file means empty); `lerta fmt --fix <name>.lerta` must then succeed
// and leave <name>.formatted (the input itself if it is missing); and `lerta fmt <name>.lerta` must
// then report nothing, as the formatted text is in the style. Then the command line: the paths it
// takes, and what it does with a file that does not parse. Whether the code of the repository is in
// the style is checked by `make check`.
import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
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
    name: 'lerta fmt leaves out the types of the files that a program holds, checked once, or alone where it does not check',
    run: () => {
      const dir = tree('programs', {
        'lib.lerta': 'export const one = (): Int -> 1\n',
        'main.lerta': "import one from './lib'\nconst two: Int = one() + 1\nprint two\n",
        'broken.lerta': "import one from './lib'\nconst three: String = one()\n",
      })
      const report = (at: string) =>
        `${at}: leave out the type, which can be inferred (Type annotations)\n`
      const held = fmt(dir, ['.'])
      const alone = fmt(dir, ['broken.lerta', 'lib.lerta'])
      return [
        ...compare_text(
          'stderr',
          report('./lib.lerta:1:20') + report('./main.lerta:2:10'),
          held.stderr,
        ),
        ...expect_status(1, held.status),
        ...compare_text('stderr alone', report('lib.lerta:1:20'), alone.stderr),
        ...expect_status(1, alone.status),
      ]
    },
  },
  {
    name: 'lerta fmt takes a file given twice once, files that import each other, and keeps the types where an import does not parse',
    run: () => {
      const dir = tree('cycles', {
        'a.lerta': "import b from './b'\nexport const a = (): Int -> 1\nprint b()\n",
        'b.lerta': "import a from './a'\nexport const b = (): Int -> a()\n",
        'c.lerta': '(\n',
        'd.lerta': "import c from './c'\nconst d: Int = 1\nprint d\n",
      })
      const report = (at: string) =>
        `${at}: leave out the type, which can be inferred (Type annotations)\n`
      const result = fmt(dir, ['a.lerta', './a.lerta', 'b.lerta', 'c.lerta', 'd.lerta'])
      const expected =
        report('a.lerta:2:18') +
        report('./a.lerta:2:18') +
        report('b.lerta:2:18') +
        "c.lerta:1:1: '(' is never closed\n"
      return [
        ...compare_text('stderr', expected, result.stderr),
        ...expect_status(1, result.status),
      ]
    },
  },
  {
    name: 'lerta fmt --fix leaves out the types of the files of one program, but one that alone uses an import',
    run: () => {
      const dir = tree('fix_program', {
        'lib.lerta': 'export const one = (): Int -> 1\n',
        'main.lerta':
          "import stdout, Writer from 'std:io'\nimport one from './lib'\nconst out: Writer = stdout\nconst two: Int = one() + 1\nprint two\n",
      })
      const result = fmt(dir, ['--fix', '.'])
      const main =
        "import stdout, Writer from 'std:io'\nimport one from './lib'\nconst out: Writer = stdout\nconst two = one() + 1\nprint two\n"
      return [
        ...expect_status(0, result.status),
        ...compare_text(
          'lib.lerta',
          'export const one = -> 1\n',
          readFileSync(join(dir, 'lib.lerta'), 'utf8'),
        ),
        ...compare_text('main.lerta', main, readFileSync(join(dir, 'main.lerta'), 'utf8')),
      ]
    },
  },
  {
    name: 'lerta fmt writes the members of enums alone, but one without which its import would be unused, through the checks of the calls that the checker rewrites',
    run: () => {
      const dir = tree('members', {
        'kinds.lerta':
          'export enum Kind\n  A\n  B\n\nexport struct Field(name: String, kind: Kind)\n\nexport const count = (kinds: Kind...) -> kinds.length\n\nexport const pick = (n: Int, options: { kind: Kind }) -> options.kind\n',
        'made.lerta':
          "import Field from './kinds'\nimport Kind from './kinds'\n\nexport const made = Field(name: 'a', kind: Kind.A)\n",
        'named.lerta':
          "import Field from './kinds'\nimport Kind from './kinds'\n\nconst name = 'b'\nexport const named = Field(name, kind: Kind.B)\n",
        'counted.lerta':
          "import count from './kinds'\nimport Kind from './kinds'\n\nexport const counted = count(Kind.A, Kind.A)\n",
        'picked.lerta':
          "import pick from './kinds'\nimport Kind from './kinds'\n\nexport const picked = pick(1, kind: Kind.A)\n",
        'test.lerta':
          "import Kind from './kinds'\n\nexport const is_b = (kind: Kind) -> kind == Kind.B\n",
        'main.lerta':
          "import counted from './counted'\nimport made from './made'\nimport named from './named'\nimport picked from './picked'\nimport is_b from './test'\n\nprint is_b(made.kind).to_string()\nprint counted\nprint is_b(picked).to_string()\nprint named.name\n",
      })
      const result = fmt(dir, ['.'])
      const report = (at: string) =>
        `${at}: write the member alone, where its enum is expected (Enum members)\n`
      const expected = report('./counted.lerta:4:30') + report('./test.lerta:3:45')
      return [
        ...compare_text('stderr', expected, result.stderr),
        ...expect_status(1, result.status),
      ]
    },
  },
  {
    name: 'lerta fmt checks once the files that a program holds through others, beside a file whose import is missing',
    run: () => {
      const dir = tree('chain', {
        'a.lerta': "import b from './b'\nprint b()\n",
        'b.lerta': "import c from './c'\nexport const b = (): Int -> c()\n",
        'c.lerta': 'export const c = (): Int -> 1\n',
        'e.lerta': "import nope from './nope'\nimport c from './c'\nprint c()\n",
      })
      const report = (at: string) =>
        `${at}: leave out the type, which can be inferred (Type annotations)\n`
      const result = fmt(dir, ['a.lerta', 'b.lerta', 'c.lerta', 'e.lerta'])
      const expected = report('b.lerta:2:18') + report('c.lerta:1:18')
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

const names = readdirSync(cases_dir)
  .filter((file) => file.endsWith('.in'))
  .map((file) => file.slice(0, -'.in'.length))
  .sort()

await run_suite(work_dir, () =>
  run_checks('format checks', [...names.map(case_check), ...command_checks]),
)
