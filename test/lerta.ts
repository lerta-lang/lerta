// Where the tests find the repository and the compiler they check, bin/lerta, which `make` builds.
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
