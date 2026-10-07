// CLI checks: each invocation of the command line and its expected exit status.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

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
const cli_succeeds = ({ args, status, produced }: CliCase): boolean =>
  spawnSync(process.execPath, [main_path, ...args], { stdio: 'ignore' }).status === status &&
  (produced?.() ?? true)
let failed_cli: CliCase[]
try {
  failed_cli = cli_cases.filter((cli_case) => !cli_succeeds(cli_case))
} finally {
  rmSync(cli_work_dir, { recursive: true, force: true })
}

for (const { args } of failed_cli) console.error(`FAIL lerta ${args.join(' ')}`)
console.log(`${cli_cases.length - failed_cli.length}/${cli_cases.length} CLI checks passed`)
process.exit(failed_cli.length === 0 ? 0 : 1)
