// Runtime checks that no Lerta program can trigger: a C program stands in for
// the generated code and is linked with the runtime as `build` links it.
import { execFileSync, spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { host_libuv, libuv_dir, root_dir } from './lerta.ts'
import { compare_text, expect_status } from './expect.ts'
import { run_checks, run_suite, type Check } from './report.ts'

const runtime_dir = join(root_dir, 'runtime')
const work_dir = mkdtempSync(join(tmpdir(), 'lerta-runtime-'))

const runtime_c_files = readdirSync(runtime_dir).filter((file) => file.endsWith('.c'))

// libuv for the host, compiled once on its own, as the compiler builds it with the runtime: with its
// flags and its warnings silenced, which the runtime, needing only its headers, does not take.
const libuv_objects_dir = join(work_dir, 'libuv')
mkdirSync(libuv_objects_dir)
execFileSync(
  'clang',
  [
    '-c',
    ...host_libuv('flag'),
    `-I${join(libuv_dir, 'include')}`,
    `-I${join(libuv_dir, 'src')}`,
    '-w',
    ...host_libuv('source').map((source) => join(libuv_dir, source)),
  ],
  { cwd: libuv_objects_dir },
)
const libuv_objects = readdirSync(libuv_objects_dir).map((file) => join(libuv_objects_dir, file))

// The flags of optimization_flags in compiler/clang_flags.lerta, which the compiler cannot apply
// to C alone.
const runtime_clang_args = (optimize: boolean): string[] => [
  ...(optimize ? ['-O2', '-flto'] : ['-D', 'LERTA_DEBUG']),
  `-I${join(libuv_dir, 'include')}`,
  ...runtime_c_files.map((file) => join(runtime_dir, file)),
  ...libuv_objects,
  ...host_libuv('library').map((library) => `-l${library}`),
]

type Outcome = { stdout: string; stderr: string; status: number | null }

// Builds the program, whose C functions `definitions` come before lerta_main, and returns the path
// of its executable.
const build_main = (
  name: string,
  main_body: string,
  optimize: boolean,
  definitions = '',
): string => {
  const source = join(work_dir, `${name}.c`)
  const executable = join(work_dir, name)
  const includes = '#include <unistd.h>\n#include "lerta.h"\n'
  writeFileSync(source, `${includes}${definitions}void lerta_main(void) {\n${main_body}\n}\n`)
  execFileSync('clang', [
    '-I',
    runtime_dir,
    source,
    ...runtime_clang_args(optimize),
    '-o',
    executable,
  ])
  return executable
}

const run_main = (
  name: string,
  main_body: string,
  optimize: boolean,
  definitions = '',
): Outcome => {
  const run = spawnSync(build_main(name, main_body, optimize, definitions), { encoding: 'utf8' })
  return { stdout: run.stdout, stderr: run.stderr, status: run.status }
}

// Runs the program with stdout and stderr on a terminal, which `script` makes, and returns what the
// terminal shows. The terminal ends lines with CRLF, and macOS's `script` may show the end of its
// input first.
const run_on_terminal = (executable: string): string => {
  const args =
    process.platform === 'darwin'
      ? ['-q', '/dev/null', executable]
      : ['-qec', executable, '/dev/null']
  return spawnSync('script', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).stdout
}

// Writes to stdout, then stderr, then stdout, and ends without flushing stdout.
const interleaved_writes = [
  '  LERTA_STATIC_STRING(first, "first\\n");',
  '  LERTA_STATIC_STRING(second, "second\\n");',
  '  LERTA_STATIC_STRING(third, "third\\n");',
  '  lerta_writer_write(1, (const LertaString *)&first);',
  '  lerta_writer_write(2, (const LertaString *)&second);',
  '  lerta_writer_write(1, (const LertaString *)&third);',
  '  _exit(0);',
].join('\n')

const leak = '  lerta_alloc(16, NULL);'

// The debug runtime stops a program that uses an object after its last release has dropped it,
// which no Lerta program does unless the generated code releases one reference too many.
const use_after_drop = (name: string, use: string): Check => ({
  name: `the debug runtime stops a ${use} of a dropped object`,
  run: () => {
    const main_body = `  void *object = lerta_alloc(16, NULL);\n  lerta_release(object);\n  lerta_${use}(object);`
    const { stderr, status } = run_main(name, main_body, false)
    const stopped = status === 0 ? ['expected the program to stop, but it exited with 0'] : []
    return [...compare_text('stderr', `${use} of a dropped object\n`, stderr), ...stopped]
  },
})
const checks: Check[] = [
  {
    // A Lerta program cannot make a directory, so the tree is made here.
    name: 'remove_tree removes a directory with everything in it',
    run: () => {
      const tree = join(work_dir, 'tree')
      const linked = join(work_dir, 'linked')
      mkdirSync(join(tree, 'inner/empty'), { recursive: true })
      mkdirSync(linked)
      writeFileSync(join(tree, 'inner/file'), '')
      writeFileSync(join(linked, 'file'), '')
      symlinkSync(linked, join(tree, 'link'))
      const removal = [
        `  LertaString *path = lerta_string_from_bytes("${tree}", ${Buffer.byteLength(tree)});`,
        '  lerta_remove_tree(path);',
        '  lerta_release(path);',
      ].join('\n')
      const { stderr, status } = run_main('remove_tree', removal, false)
      const reasons = existsSync(tree) ? [`${tree} is still there`] : []
      const kept = existsSync(join(linked, 'file')) ? [] : ['the link was followed']
      return [
        ...compare_text('stderr', '', stderr),
        ...expect_status(0, status),
        ...reasons,
        ...kept,
      ]
    },
  },
  {
    name: 'the debug runtime reports a leak',
    run: () => {
      const { stderr, status } = run_main('leak_debug', leak, false)
      return [...compare_text('stderr', 'leak: 1 object(s)\n', stderr), ...expect_status(0, status)]
    },
  },
  {
    name: 'the debug runtime accepts released objects',
    run: () => {
      const { stderr, status } = run_main(
        'released',
        '  lerta_release(lerta_alloc(16, NULL));',
        false,
      )
      return [...compare_text('stderr', '', stderr), ...expect_status(0, status)]
    },
  },
  use_after_drop('retain_dropped', 'retain'),
  use_after_drop('release_dropped', 'release'),
  {
    // A deinit sets the count to 1 while it runs (see lerta_run_deinit).
    name: 'the debug runtime stops a release of a dropped object that had a deinit',
    run: () => {
      const definitions = [
        'static void deinit(void *object) { (void)object; }',
        'static void drop_with_deinit(void *object) { lerta_run_deinit(object, deinit); }',
        '',
      ].join('\n')
      const main_body = [
        '  void *object = lerta_alloc(16, drop_with_deinit);',
        '  lerta_release(object);',
        '  lerta_release(object);',
      ].join('\n')
      const { stderr, status } = run_main('release_deinit', main_body, false, definitions)
      const stopped = status === 0 ? ['expected the program to stop, but it exited with 0'] : []
      return [...compare_text('stderr', 'release of a dropped object\n', stderr), ...stopped]
    },
  },
  {
    // More objects than it keeps, by count and by size, and one larger than all it keeps.
    name: 'the debug runtime frees the dropped objects it no longer keeps',
    run: () => {
      const main_body = [
        '  for (int i = 0; i < (1 << 21); i++) lerta_release(lerta_alloc(16, NULL));',
        '  for (int i = 0; i < 64; i++) lerta_release(lerta_alloc(1 << 20, NULL));',
        '  lerta_release(lerta_alloc(32 << 20, NULL));',
        '  lerta_release(lerta_alloc(16, NULL));',
      ].join('\n')
      const { stderr, status } = run_main('evicted', main_body, false)
      return [...compare_text('stderr', '', stderr), ...expect_status(0, status)]
    },
  },
  {
    // The parent's drop releases its child twice: the first release queues it, as the parent is
    // being dropped, and the second finds it there.
    name: 'the debug runtime stops a release of an object queued to be dropped',
    run: () => {
      const drop_parent = [
        'static void drop_parent(void *parent) {',
        '  void *child = ((void **)parent)[2];',
        '  lerta_release(child);',
        '  lerta_release(child);',
        '}',
        '',
      ].join('\n')
      const main_body = [
        '  void **parent = lerta_alloc(24, drop_parent);',
        '  parent[2] = lerta_alloc(16, NULL);',
        '  lerta_release(parent);',
      ].join('\n')
      const { stderr, status } = run_main('release_queued', main_body, false, drop_parent)
      const stopped = status === 0 ? ['expected the program to stop, but it exited with 0'] : []
      return [...compare_text('stderr', 'release of a dropped object\n', stderr), ...stopped]
    },
  },
  {
    name: 'the optimized runtime does not count objects',
    run: () => {
      const { stderr, status } = run_main('leak_optimized', leak, true)
      return [...compare_text('stderr', '', stderr), ...expect_status(0, status)]
    },
  },
  {
    name: 'stdout to a pipe is buffered, and flushed before a write to stderr',
    run: () => {
      const { stdout, stderr } = run_main('buffered', interleaved_writes, false)
      return [
        ...compare_text('stdout', 'first\n', stdout),
        ...compare_text('stderr', 'second\n', stderr),
      ]
    },
  },
  {
    name: 'stdout to a terminal is not buffered',
    run: () => {
      const shown = run_on_terminal(build_main('terminal', interleaved_writes, false))
      const expected = 'first\r\nsecond\r\nthird\r\n'
      return shown.endsWith(expected)
        ? []
        : [
            `expected the terminal to end with ${JSON.stringify(expected)}, got ${JSON.stringify(shown)}`,
          ]
    },
  },
]

await run_suite(work_dir, () => run_checks('runtime checks', checks))
