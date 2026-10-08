// CLI checks: each invocation of the command line and its expected exit status.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { run_checks } from './report.ts'

const root_dir = join(import.meta.dirname, '../..')
const cli_work_dir = mkdtempSync(join(tmpdir(), 'lerta-cli-'))
const hello = join(root_dir, 'examples/hello.lerta')
const exe = join(cli_work_dir, 'hello')
const hello_output = readFileSync(join(root_dir, 'tests/examples/hello.out'), 'utf8')
type CliCase = { args: string[]; status: number; produced?: () => boolean }

// Runs a built program with arguments of the given bytes. Node passes arguments as UTF-8, so the
// shell makes them.
const run_with_bytes = (executable: string, args: number[][]) => {
  const words = args.map(
    (bytes) => `"$(printf '${bytes.map((b) => `\\${b.toString(8)}`).join('')}')"`,
  )
  return spawnSync('sh', ['-c', `"$0" ${words.join(' ')}`, executable], { encoding: 'utf8' })
}

const invalid_argument = 'a command-line argument is not valid UTF-8\n'

// Byte sequences and whether they are UTF-8: the bounds of each length and those around the
// surrogates, then overlong forms, a surrogate, a code point above U+10FFFF, bytes that cannot
// lead, truncated sequences and a lone continuation byte.
const utf8_cases: [number[], boolean][] = [
  [[0x7f], true],
  [[0xc2, 0x80], true],
  [[0xdf, 0xbf], true],
  [[0xe0, 0xa0, 0x80], true],
  [[0xed, 0x9f, 0xbf], true],
  [[0xee, 0x80, 0x80], true],
  [[0xf0, 0x90, 0x80, 0x80], true],
  [[0xf4, 0x8f, 0xbf, 0xbf], true],
  [[0xc0, 0x80], false],
  [[0xc1, 0xbf], false],
  [[0xe0, 0x9f, 0xbf], false],
  [[0xf0, 0x8f, 0xbf, 0xbf], false],
  [[0xed, 0xa0, 0x80], false],
  [[0xf4, 0x90, 0x80, 0x80], false],
  [[0xf5, 0x80, 0x80, 0x80], false],
  [[0xe2, 0x82], false],
  [[0xc3, 0x41], false],
  [[0x80], false],
]

const cli_cases: CliCase[] = [
  {
    args: ['build', hello, '-o', `${exe}_O`, '-O', '--emit-llvm', `${exe}_O.ll`],
    status: 0,
    produced: () =>
      spawnSync(`${exe}_O`, { encoding: 'utf8' }).stdout === hello_output &&
      existsSync(`${exe}_O.ll`),
  },
  {
    // A built program gets its command-line arguments, which must be valid UTF-8.
    args: ['build', join(root_dir, 'examples/wc.lerta'), '-o', `${exe}_wc`],
    status: 0,
    produced: () => {
      const counted = spawnSync(`${exe}_wc`, [hello], { encoding: 'utf8' })
      const invalid = run_with_bytes(`${exe}_wc`, [[0xff]])
      return (
        counted.stdout === `1 3 21 ${hello}\n` &&
        invalid.status === 1 &&
        invalid.stderr === invalid_argument
      )
    },
  },
  {
    // std:process reads the arguments as it runs, even for a program that only uses `exit`.
    args: ['build', join(root_dir, 'tests/io/lib/exit_only.lerta'), '-o', `${exe}_exit`],
    status: 0,
    produced: () => {
      const invalid = run_with_bytes(`${exe}_exit`, [[0xff]])
      return invalid.status === 1 && invalid.stderr === invalid_argument
    },
  },
  {
    // decode_utf8 of each argument, which the program reads without decoding it.
    args: ['build', join(root_dir, 'tests/binary/lib/decode_arguments.lerta'), '-o', `${exe}_utf8`],
    status: 0,
    produced: () => {
      const decoded = run_with_bytes(
        `${exe}_utf8`,
        utf8_cases.map(([bytes]) => bytes),
      )
      return decoded.stdout === utf8_cases.map(([, valid]) => `${valid}\n`).join('')
    },
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
// Paths are shown relative to the repository, and the work directory as <tmp>.
const shorten_path = (arg: string): string =>
  arg.replace(cli_work_dir, '<tmp>').replace(`${root_dir}/`, '')

const run_cli_case = ({ args, status, produced }: CliCase): string[] => {
  const actual = spawnSync(process.execPath, [main_path, ...args], { stdio: 'ignore' }).status
  if (actual !== status) return [`expected exit status ${status}, got ${actual}`]
  if (produced !== undefined && !produced()) return ['the build did not produce what it should']
  return []
}

// A program does not report the warnings of the standard modules, so each is built on its own,
// where they are its warnings, and must have none.
const std_dir = join(root_dir, 'std')
const std_checks = readdirSync(std_dir).map((file) => ({
  name: `std/${file} builds without warnings`,
  run: () => {
    const args = [main_path, 'build', join(std_dir, file), '-o', join(cli_work_dir, file)]
    const { status, stderr } = spawnSync(process.execPath, args, { encoding: 'utf8' })
    return status === 0 && stderr === '' ? [] : [`exit status ${status}, stderr:\n${stderr}`]
  },
}))

let failed_count: number
try {
  failed_count = await run_checks('CLI checks', [
    ...cli_cases.map((cli_case) => ({
      name: `lerta ${cli_case.args.map(shorten_path).join(' ')}`,
      run: () => run_cli_case(cli_case),
    })),
    ...std_checks,
  ])
} finally {
  rmSync(cli_work_dir, { recursive: true, force: true })
}
process.exit(failed_count === 0 ? 0 : 1)
