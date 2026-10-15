// Invocations given by the files in tests/cli, each run in a new directory, where it must leave no
// file, nor in the directory for temporary files:
//   <name>.args    the arguments, one per line
//   <name>.in      stdin; none means empty
//   <name>.status  the expected exit status; none means 0
//   <name>.out     the expected stdout; none means empty
//   <name>.err     the expected stderr; none means empty
//   status.txt     invocations checked only by their exit status, one per line: the status, then
//                  the arguments, separated by spaces
// In the files of arguments, empty lines are skipped and lines that start with `#` are comments,
// so no argument is empty or starts with `#`, and none in status.txt has a space. In the arguments
// and the expected output, <root> stands for the repository, <tmp> for the work directory and
// <host> for the host's triple.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { root_dir } from '../lerta.ts'
import { compare_text, expect_status } from '../expect.ts'
import type { Check } from '../report.ts'
import { build_in_new_dir, expect_left, host_triple, shorten_path, work_dir } from './common.ts'

const cases_dir = join(root_dir, 'tests/cli')
const status_file = 'status.txt'
const case_extensions = ['args', 'in', 'status', 'out', 'err']

type FileCase = { args: string[]; input: string; status: number; stdout?: string; stderr?: string }

const expand = (text: string): string =>
  text
    .replaceAll('<root>', root_dir)
    .replaceAll('<tmp>', work_dir)
    .replaceAll('<host>', host_triple)

const content_lines = (text: string): string[] =>
  text.split('\n').filter((line) => line !== '' && !line.startsWith('#'))

const read_case_file = (name: string, extension: string): string | undefined => {
  const path = join(cases_dir, `${name}.${extension}`)
  return existsSync(path) ? readFileSync(path, 'utf8') : undefined
}

const read_expanded = (name: string, extension: string): string | undefined => {
  const text = read_case_file(name, extension)
  return text === undefined ? undefined : expand(text)
}

// Throws, which fails every check at load, for a status that is not a number, as an empty file.
const parse_status = (text: string, where: string): number => {
  if (!/^\d+\n?$/.test(text))
    throw new Error(`not an exit status in ${where}: ${JSON.stringify(text)}`)
  return Number(text)
}

const files = readdirSync(cases_dir)
const names = files
  .filter((file) => file.endsWith('.args'))
  .map((file) => file.slice(0, -'.args'.length))

const cases_of_files: FileCase[] = names.map((name) => ({
  args: content_lines(read_expanded(name, 'args')!),
  input: read_case_file(name, 'in') ?? '',
  status: parse_status(read_case_file(name, 'status') ?? '0', `${name}.status`),
  stdout: read_expanded(name, 'out') ?? '',
  stderr: read_expanded(name, 'err') ?? '',
}))

const cases_of_status_file: FileCase[] = content_lines(
  readFileSync(join(cases_dir, status_file), 'utf8'),
).map((line) => {
  const [status, ...args] = line.split(' ')
  return { args: args.map(expand), input: '', status: parse_status(status, status_file) }
})

const check_case = ({ args, input, status, stdout, stderr }: FileCase): Check => ({
  name: `lerta ${args.map(shorten_path).join(' ')}`,
  run: async () => {
    const ran = await build_in_new_dir(args, input)
    return [
      ...expect_status(status, ran.status),
      ...(stdout === undefined ? [] : compare_text('stdout', stdout, ran.stdout)),
      ...(stderr === undefined ? [] : compare_text('stderr', stderr, ran.stderr)),
      ...expect_left('files left', [], ran.left),
      ...expect_left('files left in the temporary directory', [], ran.left_in_temp),
    ]
  },
})

// Files that no case reads, such as the expected output of a deleted case.
const stray_files = files.filter((file) => {
  if (file === status_file) return false
  const dot = file.lastIndexOf('.')
  return !names.includes(file.slice(0, dot)) || !case_extensions.includes(file.slice(dot + 1))
})

export const file_checks: Check[] = [
  ...[...cases_of_files, ...cases_of_status_file].map(check_case),
  {
    name: 'tests/cli has no file that no case reads',
    run: () => stray_files.map((file) => `stray file: tests/cli/${file}`),
  },
]
