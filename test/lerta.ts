// Where the tests find the repository and the compiler they check, bin/lerta, which `make` builds,
// how they run it, and what they need of it before they start.
import { execFile } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const root_dir = join(import.meta.dirname, '..')

export const compiler = join(root_dir, 'bin/lerta')
if (!existsSync(compiler)) {
  console.error(`${compiler} is missing: run make, or make test, which builds it first`)
  process.exit(2)
}

// The most output kept from a program that a test runs; the limit only stops runaway output.
export const OUTPUT_LIMIT = 64 * 1024 * 1024

// The compiler caches the runtime it compiles; the tests give it a new cache, which the compilers
// they run inherit, so that no cache left by another build of the compiler takes part.
const cache_dir = mkdtempSync(join(tmpdir(), 'lerta-cache-'))
process.env.LERTA_CACHE_DIR = cache_dir
process.on('exit', () => rmSync(cache_dir, { recursive: true, force: true }))

// What third_party/libuv.txt lists of the kind for the host's system, by the rule of is_for in
// compiler/libuv.lerta: its sources, relative to libuv's root, its flags or its libraries.
const host_system = { darwin: 'macos', win32: 'windows' }[process.platform as string] ?? 'linux'
const host_systems = [host_system, 'all', ...(host_system === 'windows' ? [] : ['posix'])]
export const libuv_dir = join(root_dir, 'third_party', 'libuv')
export const host_libuv = (kind: 'source' | 'flag' | 'library'): string[] =>
  readFileSync(join(root_dir, 'third_party', 'libuv.txt'), 'utf8')
    .split('\n')
    .filter((line) => line !== '' && !line.startsWith('#'))
    .map((line) => line.split(' '))
    .filter(([systems, line_kind]) => line_kind === kind && host_systems.includes(systems))
    .map(([, , value]) => value)

// Runs a file to its end, whatever its exit status; `failure` tells how it ended, for messages.
export const run_file = (
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

// Builds a program in `dir` with each of the sets of flags, so that the compiler caches each kind of
// runtime before the tests start. Otherwise the tests started together would each compile the same
// runtime, and each such compile runs as many clang processes as there are CPUs.
export const build_runtimes = async (dir: string, flag_sets: string[][]): Promise<void> => {
  const builds = flag_sets.map(async (flags, index) => {
    const args = ['build', 'tests/empty.lerta', '-o', join(dir, `runtime${index}`), ...flags]
    const { status, failure, stderr } = await run_file(compiler, args, root_dir)
    if (status !== 0) {
      const what = `tests/empty with [${flags.join(' ')}]`
      throw new Error(`the build of ${what} failed (${failure}):\n${stderr}`)
    }
  })
  await Promise.all(builds)
}
