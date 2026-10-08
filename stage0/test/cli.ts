// CLI checks: each invocation of the command line and its expected exit status.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { run_checks } from './report.ts'

const root_dir = join(import.meta.dirname, '../..')
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
  {
    // A built program gets its command-line arguments, which must be valid UTF-8.
    args: ['build', join(root_dir, 'examples/wc.lerta'), '-o', `${exe}_wc`],
    status: 0,
    produced: () => {
      const counted = spawnSync(`${exe}_wc`, [hello], { encoding: 'utf8' })
      // Node passes arguments as UTF-8, so the shell makes the invalid byte.
      const invalid = spawnSync('sh', ['-c', '"$0" "$(printf \'\\377\')"', `${exe}_wc`])
      return (
        counted.stdout === `1 3 21 ${hello}\n` &&
        invalid.status === 1 &&
        invalid.stderr.toString() === 'a command-line argument is not valid UTF-8\n'
      )
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

let failed_count: number
try {
  failed_count = await run_checks(
    'CLI checks',
    cli_cases.map((cli_case) => ({
      name: `lerta ${cli_case.args.map(shorten_path).join(' ')}`,
      run: () => run_cli_case(cli_case),
    })),
  )
} finally {
  rmSync(cli_work_dir, { recursive: true, force: true })
}
process.exit(failed_count === 0 ? 0 : 1)
