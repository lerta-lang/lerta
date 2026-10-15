// What the CLI checks share: their work directory, the program most of them build, and running
// the compiler.
import { closeSync, mkdtempSync, openSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { spawn, spawnSync, type SpawnOptions, type StdioOptions } from 'node:child_process'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { compiler, OUTPUT_LIMIT, root_dir } from '../lerta.ts'
import { compare_text, lines } from '../expect.ts'

export const work_dir = mkdtempSync(join(tmpdir(), 'lerta-cli-'))
export const hello = join(root_dir, 'examples/hello.lerta')
export const hello_output = readFileSync(join(root_dir, 'tests/examples/hello.out'), 'utf8')
export const host_triple = spawnSync('clang', ['-print-target-triple'], {
  encoding: 'utf8',
}).stdout.trim()

// The flags of each kind of runtime that the checks build with, optimized or not, and for a target
// given as the host's own triple, which every host can run.
export const runtime_flags = [[], ['-O'], ['--target', host_triple]]

// Paths are shown relative to the repository, and the work directory as <tmp>.
export const shorten_path = (arg: string): string =>
  arg.replace(work_dir, '<tmp>').replace(`${root_dir}/`, '').replace(root_dir, '<root>')

export const new_cache_dir = () => mkdtempSync(join(work_dir, 'cache-'))

export type Env = Record<string, string | undefined>

export const env_with = (changes: Env): Record<string, string> =>
  Object.fromEntries(
    Object.entries({ ...process.env, ...changes }).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  )

// Runs the compiler in a new directory, with another new one as the system's directory for
// temporary files, and returns what it left in each. `env` replaces variables of the environment,
// such as PATH; an undefined one is removed. stdin is a file of `input`: on Linux, Node gives a
// child a socket for a pipe, which /dev/stdin cannot open.
export const build_in_new_dir = async (args: string[], input = '', env: Env = {}) => {
  const cwd = mkdtempSync(join(work_dir, 'cwd-'))
  const temp = mkdtempSync(join(work_dir, 'temp-'))
  const input_path = join(work_dir, `${basename(cwd)}.in`)
  writeFileSync(input_path, input)
  const stdin = openSync(input_path, 'r')
  const stdio: StdioOptions = [stdin, 'pipe', 'pipe']
  const built = await run_command(compiler, args, {
    cwd,
    env: env_with({ TMPDIR: temp, ...env }),
    stdio,
  })
  closeSync(stdin)
  return { ...built, cwd, left: readdirSync(cwd), left_in_temp: readdirSync(temp) }
}

export type Ran = { status: number | null; stdout: string; stderr: string; error?: Error }

// Runs a command, as spawnSync does, with stdin closed unless `stdio` gives one, without holding up
// the checks that run at the same time.
export const run_command = (
  command: string,
  args: string[],
  options: SpawnOptions = {},
): Promise<Ran> =>
  new Promise((resolve) => {
    const child = spawn(command, args, options)
    let stdout = ''
    let stderr = ''
    const stop_past_limit = () => {
      if (stdout.length + stderr.length <= OUTPUT_LIMIT) return
      child.kill()
      resolve({ status: null, stdout, stderr, error: new Error('too much output') })
    }
    child.stdout?.setEncoding('utf8').on('data', (data) => {
      stdout += data
      stop_past_limit()
    })
    child.stderr?.setEncoding('utf8').on('data', (data) => {
      stderr += data
      stop_past_limit()
    })
    child.stdin?.end()
    child.on('error', (error) => resolve({ status: null, stdout, stderr, error }))
    child.on('close', (status) => resolve({ status, stdout, stderr }))
  })

export const expect_left = (what: string, expected: string[], actual: string[]): string[] =>
  compare_text(what, lines(expected), lines(actual.toSorted()))
