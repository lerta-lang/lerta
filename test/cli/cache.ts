// The runtime that the compiler compiles once for each kind of build and target, and caches.
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { spawnSync } from 'node:child_process'
import { basename, join } from 'node:path'
import { compiler, host_libuv, root_dir } from '../lerta.ts'
import { compare_text, expect_status, expect_success } from '../expect.ts'
import type { Check } from '../report.ts'
import {
  build_in_new_dir,
  env_with,
  expect_left,
  hello,
  host_triple,
  new_cache_dir,
  run_command,
  work_dir,
  type Env,
  type Ran,
} from './common.ts'

const runtime_objects = readdirSync(join(root_dir, 'runtime'))
  .filter((file) => file.endsWith('.c'))
  .map((file) => file.replace(/\.c$/, '.o'))
// libuv's objects for the host, each named by its source's path, as `src/unix/core.c` is
// `libuv-src-unix-core.o`.
const libuv_objects = host_libuv('source').map(
  (source) => `libuv-${source.replace(/\.c$/, '').split('/').join('-')}.o`,
)
const attributes_file = 'function_attributes.txt'
const coro_end_file = 'coro_end_type.txt'
const cached_runtime_files = [
  ...runtime_objects,
  ...libuv_objects,
  attributes_file,
  coro_end_file,
].sort()

// The name of a cached runtime, of the kind given and a target that matches `target`, a regular
// expression, and what it holds.
const expect_cached_runtime = (cache: string, name: string, kind: string, target: string) => {
  const pattern = new RegExp(`^runtime-${kind}-${target}-clang\\d+-[0-9A-F]{8}$`)
  if (!pattern.test(name)) return [`the cached runtime ${name} does not match ${pattern}`]
  const dir = join(cache, name)
  const files = expect_left(`the files of ${name}`, cached_runtime_files, readdirSync(dir))
  if (files.length > 0) return files
  const attributes = readFileSync(join(dir, attributes_file), 'utf8')
  const coro_end_type = readFileSync(join(dir, coro_end_file), 'utf8')
  return [
    ...(attributes.includes('"target-cpu"=')
      ? []
      : [`no target-cpu in ${attributes_file}: ${attributes}`]),
    ...(['i1', 'void'].includes(coro_end_type)
      ? []
      : [`not a type in ${coro_end_file}: ${coro_end_type}`]),
  ]
}

// Builds hello.lerta with the environment changed as given.
const build_hello_with = async (env: Env, flags: string[] = []) => {
  const built = await build_in_new_dir(['build', hello, '-o', 'hello', ...flags], '', env)
  return { reasons: expect_success('build', built), built }
}

// The runtimes in a cache, where an optimized build also has the linker keep what ThinLTO
// optimizes, in `thinlto`.
const runtimes_in = (cache: string): string[] =>
  existsSync(cache) ? readdirSync(cache).filter((entry) => entry !== 'thinlto') : []

// What ThinLTO left in a cache, each with when it was written: an entry optimized again would have
// the same name, but a new time. The linker also writes when it last pruned the cache.
const lto_entries = (cache: string): string[] => {
  const lto_cache = join(cache, 'thinlto')
  return existsSync(lto_cache)
    ? readdirSync(lto_cache)
        .filter((entry) => entry !== 'llvmcache.timestamp')
        .sort()
        .map((entry) => `${entry} ${statSync(join(lto_cache, entry)).mtimeMs}`)
    : []
}

// Builds hello.lerta with `flags`, after which `cache` must hold one runtime, of `kind` and a
// target that matches `target`, a regular expression.
const expect_one_cached_runtime = async (
  env: Env,
  cache: string,
  {
    flags = [],
    kind = 'debug',
    target = '.+',
  }: { flags?: string[]; kind?: string; target?: string } = {},
): Promise<string[]> => {
  const { reasons } = await build_hello_with(env, flags)
  if (reasons.length > 0) return reasons
  const entries = runtimes_in(cache)
  if (entries.length !== 1) return [`expected one cached runtime in ${cache}, found: ${entries}`]
  return expect_cached_runtime(cache, entries[0], kind, target)
}

// A second build uses the cached runtime, and what ThinLTO optimized, as they are.
const expect_reused = async (cache: string, flags: string[]): Promise<string[]> => {
  const [name] = runtimes_in(cache)
  const object = join(cache, name, runtime_objects[0])
  const built_at = statSync(object).mtimeMs
  const optimized = lto_entries(cache)
  const { reasons } = await build_hello_with({ LERTA_CACHE_DIR: cache }, flags)
  if (reasons.length > 0) return reasons
  const entries = runtimes_in(cache)
  if (entries.length !== 1) return [`the second build changed the cache: ${entries}`]
  if (statSync(object).mtimeMs !== built_at) return ['the second build compiled the runtime again']
  if (lto_entries(cache).join() !== optimized.join())
    return [`the second build optimized again: ${lto_entries(cache)}`]
  return []
}

// A cached runtime that lost a file is reported, not compiled again.
const expect_incomplete_reported = async (cache: string, flags: string[]): Promise<string[]> => {
  const dir = join(cache, runtimes_in(cache)[0])
  rmSync(join(dir, attributes_file))
  const { built } = await build_hello_with({ LERTA_CACHE_DIR: cache }, flags)
  return [
    ...expect_status(1, built.status),
    ...compare_text('stderr', `the cached runtime ${dir} is incomplete: remove it\n`, built.stderr),
  ]
}

const host_pattern = host_triple.replaceAll('.', '\\.')

// The name of the runtime that a debug build for the host caches.
const find_cached_runtime_name = async (): Promise<string> => {
  const cache = new_cache_dir()
  const { reasons } = await build_hello_with({ LERTA_CACHE_DIR: cache })
  if (reasons.length > 0) throw new Error(reasons.join('\n'))
  return runtimes_in(cache)[0]
}

// Found once, for the checks that run at the same time, since finding it compiles the runtime.
let runtime_name: Promise<string> | undefined
const cached_runtime_name = (): Promise<string> => (runtime_name ??= find_cached_runtime_name())
// For the checks that use the name, so that finding it is not counted in their time. A failure is
// left for them to report.
const wait_for_runtime_name = () => cached_runtime_name().catch(() => undefined)

// Makes the directory of the runtime's name in a new cache, has `prepare` fill it, builds, and
// checks the build with `check`.
const with_cached_runtime_dir = async (
  prepare: (dir: string) => void,
  check: (built: Ran, dir: string) => string[],
): Promise<string[]> => {
  const cache = new_cache_dir()
  const dir = join(cache, await cached_runtime_name())
  mkdirSync(dir)
  prepare(dir)
  return check((await build_hello_with({ LERTA_CACHE_DIR: cache })).built, dir)
}

const kind_checks: Check[] = [
  { flags: [], kind: 'debug' },
  { flags: ['-O'], kind: 'release' },
].map(({ flags, kind }) => ({
  name: `lerta build ${[...flags, ''].join(' ')}caches the ${kind} runtime, and uses it again`,
  run: async () => {
    const cache = new_cache_dir()
    const cached = await expect_one_cached_runtime({ LERTA_CACHE_DIR: cache }, cache, {
      flags,
      kind,
      target: host_pattern,
    })
    if (cached.length > 0) return cached
    const optimized = lto_entries(cache)
    if ((kind === 'release') !== optimized.length > 0)
      return [`${flags.join(' ')} left the ThinLTO cache with: ${optimized}`]
    const reused = await expect_reused(cache, flags)
    if (reused.length > 0) return reused
    return expect_incomplete_reported(cache, flags)
  },
}))

export const cache_checks: Check[] = [
  ...kind_checks,
  {
    // The host given as the target is in the name too, but clang is given other flags.
    name: 'lerta build --target <host> caches the runtime named by the host',
    run: () => {
      const cache = new_cache_dir()
      const flags = ['--target', host_triple]
      return expect_one_cached_runtime({ LERTA_CACHE_DIR: cache }, cache, {
        flags,
        target: host_pattern,
      })
    },
  },
  {
    name: 'lerta build compiles the runtime into an empty directory of its name',
    wait: wait_for_runtime_name,
    run: () =>
      with_cached_runtime_dir(
        () => {},
        (built, dir) => [
          ...expect_success('build', built),
          ...expect_left(`the files of ${basename(dir)}`, cached_runtime_files, readdirSync(dir)),
        ],
      ),
  },
  {
    name: 'lerta build fails when another directory has the name of the runtime',
    wait: wait_for_runtime_name,
    run: () =>
      with_cached_runtime_dir(
        (dir) => writeFileSync(join(dir, 'other'), ''),
        (built, dir) => [
          ...expect_status(1, built.status),
          ...compare_text(
            'stderr',
            `cannot move the compiled runtime into the cache: ${dir}\n`,
            built.stderr,
          ),
        ],
      ),
  },
  {
    name: 'lerta build removes the staging directories that killed builds left',
    wait: wait_for_runtime_name,
    run: async () => {
      const cache = new_cache_dir()
      const name = await cached_runtime_name()
      const staging = (suffix: string) => `${name}.staging-${suffix}`
      // A process that has ended, whose ID the system is unlikely to give another so soon.
      const ended = spawnSync(process.execPath, ['-e', '']).pid
      const kept = [
        staging(`${process.pid}-lerta-running`),
        staging('lerta-other'),
        staging(`-${ended}-lerta-other`),
        `other.staging-${ended}-lerta-other`,
      ]
      for (const dir of [staging(`${ended}-lerta-killed`), ...kept]) {
        mkdirSync(join(cache, dir))
        writeFileSync(join(cache, dir, 'array.o'), '')
      }
      writeFileSync(join(cache, staging(`${ended}-file`)), '')
      const { reasons } = await build_hello_with({ LERTA_CACHE_DIR: cache })
      if (reasons.length > 0) return reasons
      return [
        ...expect_cached_runtime(cache, name, 'debug', '.+'),
        ...expect_left('the cache', [name, ...kept].sort(), readdirSync(cache)),
      ]
    },
  },
  {
    name: 'lerta build goes on when it cannot remove a staging directory that a killed build left',
    wait: wait_for_runtime_name,
    run: async () => {
      // root removes a directory whatever its mode, as in the Docker containers of test-cross.
      if (process.getuid?.() === 0) return undefined
      const cache = new_cache_dir()
      const name = await cached_runtime_name()
      const ended = spawnSync(process.execPath, ['-e', '']).pid
      const locked = join(cache, `${name}.staging-${ended}-lerta-killed`, 'locked')
      mkdirSync(locked, { recursive: true })
      writeFileSync(join(locked, 'array.o'), '')
      chmodSync(locked, 0o500)
      try {
        const { reasons } = await build_hello_with({ LERTA_CACHE_DIR: cache })
        if (reasons.length > 0) return reasons
        return [
          ...(existsSync(locked) ? [] : ['the staging directory was removed, so nothing failed']),
          ...expect_cached_runtime(cache, name, 'debug', '.+'),
        ]
      } finally {
        chmodSync(locked, 0o700)
      }
    },
  },
  {
    name: 'lerta build fails when the cache directory cannot be made',
    run: async () => {
      const file = join(new_cache_dir(), 'file')
      writeFileSync(file, '')
      const { built } = await build_hello_with({ LERTA_CACHE_DIR: join(file, 'cache') })
      return [
        ...expect_status(1, built.status),
        ...compare_text('stderr', `cannot make the cache directory: ${file}/cache\n`, built.stderr),
      ]
    },
  },
  {
    name: 'lerta build rejects a target that would name a path in the cache',
    run: async () => {
      const cache = new_cache_dir()
      const { built } = await build_hello_with({ LERTA_CACHE_DIR: join(cache, 'inner') }, [
        '--target',
        '../outside',
      ])
      return [
        ...expect_status(1, built.status),
        ...compare_text('stderr', 'not a target: ../outside\n', built.stderr),
        ...expect_left('files beside the cache', [], readdirSync(cache)),
      ]
    },
  },
  {
    name: 'lerta build rejects a target that would name a Windows path in the cache',
    run: async () => {
      const { built } = await build_hello_with({ LERTA_CACHE_DIR: new_cache_dir() }, [
        '--target',
        '..\\outside',
      ])
      return [
        ...expect_status(1, built.status),
        ...compare_text('stderr', 'not a target: ..\\outside\n', built.stderr),
      ]
    },
  },
  {
    name: 'lerta build rejects a target of a system that the runtime is not built for',
    run: async () => {
      const cache = new_cache_dir()
      const { built } = await build_hello_with({ LERTA_CACHE_DIR: cache }, [
        '--target',
        'x86_64-unknown-freebsd',
      ])
      const message = 'not a target that the runtime is built for: x86_64-unknown-freebsd\n'
      return [
        ...expect_status(1, built.status),
        ...compare_text('stderr', message, built.stderr),
        ...expect_left('files left in the cache', [], readdirSync(cache)),
      ]
    },
  },
  {
    name: 'lerta build caches the runtime in $XDG_CACHE_HOME/lerta without $LERTA_CACHE_DIR',
    run: async () => {
      const cache_home = new_cache_dir()
      const env = { LERTA_CACHE_DIR: '', XDG_CACHE_HOME: cache_home }
      return expect_one_cached_runtime(env, join(cache_home, 'lerta'))
    },
  },
  {
    name: 'lerta build caches the runtime in ~/.cache/lerta without $XDG_CACHE_HOME',
    run: async () => {
      const home = new_cache_dir()
      const env = { LERTA_CACHE_DIR: undefined, XDG_CACHE_HOME: '', HOME: home }
      return expect_one_cached_runtime(env, join(home, '.cache/lerta'))
    },
  },
  {
    name: 'lerta build fails without $HOME, $XDG_CACHE_HOME or $LERTA_CACHE_DIR',
    run: async () => {
      const env = { LERTA_CACHE_DIR: undefined, XDG_CACHE_HOME: undefined, HOME: undefined }
      const { built } = await build_hello_with(env)
      return [
        ...expect_status(1, built.status),
        ...compare_text(
          'stderr',
          'no cache directory: set HOME or LERTA_CACHE_DIR\n',
          built.stderr,
        ),
      ]
    },
  },
  {
    name: 'lerta build leaves one complete runtime in the cache for builds that start at once',
    run: async () => {
      const cache = new_cache_dir()
      const env = { LERTA_CACHE_DIR: cache }
      const builds = [1, 2, 3, 4].map((i) =>
        run_command(
          compiler,
          ['build', hello, '-o', join(cache, `../${basename(cache)}_hello${i}`)],
          {
            cwd: work_dir,
            env: env_with(env),
          },
        ),
      )
      const reasons = (await Promise.all(builds)).flatMap((built) => expect_success('build', built))
      if (reasons.length > 0) return reasons
      const entries = runtimes_in(cache)
      if (entries.length !== 1) return [`expected one cached runtime, found: ${entries}`]
      return expect_cached_runtime(cache, entries[0], 'debug', '.+')
    },
  },
]
