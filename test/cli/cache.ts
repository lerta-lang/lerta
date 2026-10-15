// The runtime that the compiler compiles once for each kind of build and target, and caches.
import { spawn } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
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
  work_dir,
  type Env,
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

// Builds hello.lerta with the environment changed as given, and gives the cache's entries after.
const build_hello_with = (env: Env, flags: string[] = []) => {
  const built = build_in_new_dir(['build', hello, '-o', 'hello', ...flags], '', env)
  return { reasons: expect_success('build', built), built }
}

const expect_one_cached_runtime = (env: Env, cache: string): string[] => {
  const { reasons } = build_hello_with(env)
  if (reasons.length > 0) return reasons
  const entries = existsSync(cache) ? readdirSync(cache) : []
  if (entries.length !== 1) return [`expected one cached runtime in ${cache}, found: ${entries}`]
  return expect_cached_runtime(cache, entries[0], 'debug', '.+')
}

// Runs the compiler, as spawnSync does, without waiting for it.
const spawn_compiler = (
  args: string[],
  env: Env,
): Promise<{ status: number | null; stderr: string }> =>
  new Promise((resolve) => {
    const child = spawn(compiler, args, { cwd: work_dir, env: env_with(env) })
    let stderr = ''
    child.stderr.on('data', (data) => (stderr += data))
    child.on('close', (status) => resolve({ status, stderr }))
  })

// The name of the runtime that a debug build for the host caches.
const cached_runtime_name = (): string => {
  const cache = new_cache_dir()
  const { reasons } = build_hello_with({ LERTA_CACHE_DIR: cache })
  if (reasons.length > 0) throw new Error(reasons.join('\n'))
  return readdirSync(cache)[0]
}

// Makes the directory of the runtime's name in a new cache, has `prepare` fill it, builds, and
// checks the build with `check`.
const with_cached_runtime_dir = (
  prepare: (dir: string) => void,
  check: (built: ReturnType<typeof build_in_new_dir>, dir: string) => string[],
): string[] => {
  const cache = new_cache_dir()
  const dir = join(cache, cached_runtime_name())
  mkdirSync(dir)
  prepare(dir)
  return check(build_hello_with({ LERTA_CACHE_DIR: cache }).built, dir)
}

export const cache_checks: Check[] = [
  {
    name: 'lerta build caches the runtime for each kind of build, and uses it again',
    run: () => {
      const cache = new_cache_dir()
      const env = { LERTA_CACHE_DIR: cache }
      const host = host_triple.replaceAll('.', '\\.')
      const kinds: [string[], string][] = [
        [[], 'debug'],
        [['-O'], 'release'],
      ]
      // An optimized build also has the linker keep what ThinLTO optimizes, in `thinlto`.
      const lto_cache = join(cache, 'thinlto')
      // The linker also writes when it last pruned the cache. An entry optimized again would
      // have the same name, but a new time.
      const lto_entries = () =>
        existsSync(lto_cache)
          ? readdirSync(lto_cache)
              .filter((entry) => entry !== 'llvmcache.timestamp')
              .sort()
              .map((entry) => `${entry} ${statSync(join(lto_cache, entry)).mtimeMs}`)
          : []
      const runtimes = () => readdirSync(cache).filter((entry) => entry !== 'thinlto')
      for (const [flags, kind] of kinds) {
        const before = runtimes()
        const { reasons } = build_hello_with(env, flags)
        if (reasons.length > 0) return reasons
        const added = runtimes().filter((entry) => !before.includes(entry))
        if (added.length !== 1) return [`${flags.join(' ')} added to the cache: ${added}`]
        const problems = expect_cached_runtime(cache, added[0], kind, host)
        if (problems.length > 0) return problems
        const optimized = lto_entries()
        if ((kind === 'release') !== optimized.length > 0)
          return [`${flags.join(' ')} left the ThinLTO cache with: ${optimized}`]
        const object = join(cache, added[0], runtime_objects[0])
        const built_at = statSync(object).mtimeMs
        const again = build_hello_with(env, flags).reasons
        if (again.length > 0) return again
        const entries = runtimes()
        if (entries.length !== before.length + 1)
          return [`the second build changed the cache: ${entries}`]
        if (statSync(object).mtimeMs !== built_at)
          return [`the second build compiled the runtime again`]
        if (lto_entries().join() !== optimized.join())
          return [`the second build optimized again: ${lto_entries()}`]
        // A runtime that lost a file is reported, not compiled again.
        rmSync(join(cache, added[0], attributes_file))
        const { built } = build_hello_with(env, flags)
        const message = `the cached runtime ${join(cache, added[0])} is incomplete: remove it\n`
        const problems_after_loss = [
          ...expect_status(1, built.status),
          ...compare_text('stderr', message, built.stderr),
        ]
        if (problems_after_loss.length > 0) return problems_after_loss
        rmSync(join(cache, added[0]), { recursive: true })
      }
      // The host given as the target is in the name too, but clang is given other flags.
      const before = readdirSync(cache)
      const { reasons } = build_hello_with(env, ['--target', host_triple])
      if (reasons.length > 0) return reasons
      const added = readdirSync(cache).filter((entry) => !before.includes(entry))
      if (added.length !== 1) return [`--target ${host_triple} added to the cache: ${added}`]
      return expect_cached_runtime(cache, added[0], 'debug', host)
    },
  },
  {
    name: 'lerta build compiles the runtime into an empty directory of its name',
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
    name: 'lerta build ignores a staging directory that a killed build left',
    run: () => {
      const cache = new_cache_dir()
      const name = cached_runtime_name()
      mkdirSync(join(cache, `${name}.staging-lerta-killed`))
      writeFileSync(join(cache, `${name}.staging-lerta-killed`, 'array.o'), '')
      const { reasons } = build_hello_with({ LERTA_CACHE_DIR: cache })
      if (reasons.length > 0) return reasons
      return expect_cached_runtime(cache, name, 'debug', '.+')
    },
  },
  {
    name: 'lerta build fails when the cache directory cannot be made',
    run: () => {
      const file = join(new_cache_dir(), 'file')
      writeFileSync(file, '')
      const { built } = build_hello_with({ LERTA_CACHE_DIR: join(file, 'cache') })
      return [
        ...expect_status(1, built.status),
        ...compare_text('stderr', `cannot make the cache directory: ${file}/cache\n`, built.stderr),
      ]
    },
  },
  {
    name: 'lerta build rejects a target that would name a path in the cache',
    run: () => {
      const cache = new_cache_dir()
      const { built } = build_hello_with({ LERTA_CACHE_DIR: join(cache, 'inner') }, [
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
    run: () => {
      const { built } = build_hello_with({ LERTA_CACHE_DIR: new_cache_dir() }, [
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
    run: () => {
      const cache = new_cache_dir()
      const { built } = build_hello_with({ LERTA_CACHE_DIR: cache }, [
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
    run: () => {
      const cache_home = new_cache_dir()
      const env = { LERTA_CACHE_DIR: '', XDG_CACHE_HOME: cache_home }
      return expect_one_cached_runtime(env, join(cache_home, 'lerta'))
    },
  },
  {
    name: 'lerta build caches the runtime in ~/.cache/lerta without $XDG_CACHE_HOME',
    run: () => {
      const home = new_cache_dir()
      const env = { LERTA_CACHE_DIR: undefined, XDG_CACHE_HOME: '', HOME: home }
      return expect_one_cached_runtime(env, join(home, '.cache/lerta'))
    },
  },
  {
    name: 'lerta build fails without $HOME, $XDG_CACHE_HOME or $LERTA_CACHE_DIR',
    run: () => {
      const env = { LERTA_CACHE_DIR: undefined, XDG_CACHE_HOME: undefined, HOME: undefined }
      const { built } = build_hello_with(env)
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
        spawn_compiler(['build', hello, '-o', join(cache, `../${basename(cache)}_hello${i}`)], env),
      )
      const reasons = (await Promise.all(builds)).flatMap((built) => expect_success('build', built))
      if (reasons.length > 0) return reasons
      const entries = readdirSync(cache)
      if (entries.length !== 1) return [`expected one cached runtime, found: ${entries}`]
      return expect_cached_runtime(cache, entries[0], 'debug', '.+')
    },
  },
]
