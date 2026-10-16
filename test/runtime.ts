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

// Writes to stdout, then stderr, then stdout, through Writers, and ends as `ending` does.
const interleaved_writes = (ending: string): string =>
  [
    '  LERTA_STATIC_STRING(first, "first\\n");',
    '  LERTA_STATIC_STRING(second, "second\\n");',
    '  LERTA_STATIC_STRING(third, "third\\n");',
    '  lerta_release(lerta_stream_write(1, (const LertaString *)&first));',
    '  lerta_release(lerta_stream_write(2, (const LertaString *)&second));',
    '  lerta_release(lerta_stream_write(1, (const LertaString *)&third));',
    ending,
  ].join('\n')

const leak = '  lerta_alloc(16, NULL);'

// Whether the debug program, built as run_main builds it, stops with the message.
const stops_with = (
  name: string,
  message: string,
  main_body: string,
  definitions = '',
): string[] => {
  const { stderr, status } = run_main(name, main_body, false, definitions)
  const stopped = status === 0 ? ['expected the program to stop, but it exited with 0'] : []
  return [...compare_text('stderr', `${message}\n`, stderr), ...stopped]
}

const use_after_drop = (name: string, use: string): Check => ({
  name: `the debug runtime stops a ${use} of a dropped object`,
  run: () =>
    stops_with(
      name,
      `${use} of a dropped object`,
      `  void *object = lerta_alloc(16, NULL);\n  lerta_release(object);\n  lerta_${use}(object);`,
    ),
})
// Sizes at the edges of the size classes, of slabs and of regions of their own.
const sizes = `static const int64_t sizes[] = {16, 17, 24, 255, 256, 257, 320, 321, 16384, 16385, 100000};
#define SIZES (int)(sizeof sizes / sizeof sizes[0])
`

// Objects at the edges of the size classes, of slabs and of regions of their own, each filled
// with bytes of its own, which must all be there once all are allocated; then more objects of one
// size than the empty slabs that the allocator keeps hold, dropped and allocated again.
const allocate_sizes_definitions = `#include <string.h>
${sizes}#define PER_SIZE 200
#define MANY 20000
static uint8_t *objects[SIZES][PER_SIZE];
static void *many[MANY];
static uint8_t fill_of(int s, int i) { return (uint8_t)(s * 31 + i); }
`
const allocate_sizes = `  for (int s = 0; s < SIZES; s++) {
    for (int i = 0; i < PER_SIZE; i++) {
      objects[s][i] = lerta_alloc(sizes[s], NULL);
      memset(objects[s][i] + 16, fill_of(s, i), (size_t)sizes[s] - 16);
    }
  }
  for (int s = 0; s < SIZES; s++) {
    for (int i = 0; i < PER_SIZE; i++) {
      for (int64_t b = 16; b < sizes[s]; b++) {
        if (objects[s][i][b] != fill_of(s, i)) _exit(1);
      }
      lerta_release(objects[s][i]);
    }
  }
  for (int round = 0; round < 2; round++) {
    for (int i = 0; i < MANY; i++) many[i] = lerta_alloc(32, NULL);
    for (int i = 0; i < MANY; i++) lerta_release(many[i]);
  }`

// A buffer grown from none through the sizes, which keeps what it held each time; then grown within
// its place, in a slab and in a region of its own, and given a size more than half of it, which
// keep the place, and one far smaller, which does not.
const reallocate_definitions = `#include <string.h>
#include "internal.h"
${sizes}static uint8_t fill_of(int64_t b) { return (uint8_t)(b * 7); }
`
const reallocate = `  uint8_t *buffer = NULL;
  int64_t filled = 0;
  for (int s = 0; s < SIZES; s++) {
    buffer = lerta_mem_realloc(buffer, sizes[s]);
    for (int64_t b = 0; b < filled; b++) {
      if (buffer[b] != fill_of(b)) _exit(1);
    }
    for (; filled < sizes[s]; filled++) buffer[filled] = fill_of(filled);
  }
  lerta_mem_free(buffer);
  uint8_t *small = lerta_mem_alloc(17);
  if (lerta_mem_realloc(small, 24) != small) _exit(2);
  uint8_t *large = lerta_mem_alloc(20000);
  if (lerta_mem_realloc(large, 60000) != large) _exit(3);
  if (lerta_mem_realloc(large, 40000) != large) _exit(4);
  large[0] = 9;
  uint8_t *shrunk = lerta_mem_realloc(large, 16);
  if (shrunk == large || shrunk[0] != 9) _exit(5);
  lerta_mem_free(small);
  lerta_mem_free(shrunk);
  lerta_mem_free(NULL);`

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
    // A new object of the same size does not take the dropped one's place, in a slab with room.
    name: 'the debug runtime stops a release of a dropped object after another is allocated',
    run: () =>
      stops_with(
        'release_after_allocation',
        'release of a dropped object',
        [
          '  lerta_alloc(16, NULL);',
          '  void *object = lerta_alloc(16, NULL);',
          '  lerta_release(object);',
          '  lerta_alloc(16, NULL);',
          '  lerta_release(object);',
        ].join('\n'),
      ),
  },
  {
    // Nor after the dropped one's slab has become empty, which stays its class's slab with room.
    name: 'the debug runtime stops a retain of a dropped object whose slab became empty',
    run: () =>
      stops_with(
        'retain_after_empty_slab',
        'retain of a dropped object',
        [
          '  void *object = lerta_alloc(24, NULL);',
          '  lerta_release(object);',
          '  for (int i = 0; i < 100; i++) lerta_alloc(24, NULL);',
          '  lerta_retain(object);',
        ].join('\n'),
      ),
  },
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
      return stops_with('release_deinit', 'release of a dropped object', main_body, definitions)
    },
  },
  ...[false, true].map((optimize): Check => ({
    name: `the ${optimize ? 'optimized' : 'debug'} runtime allocates objects of every kind of size`,
    run: () => {
      const { stderr, status } = run_main(
        optimize ? 'sizes_optimized' : 'sizes_debug',
        allocate_sizes,
        optimize,
        allocate_sizes_definitions,
      )
      return [...compare_text('stderr', '', stderr), ...expect_status(0, status)]
    },
  })),
  ...[false, true].map((optimize): Check => ({
    name: `the ${optimize ? 'optimized' : 'debug'} runtime reallocates buffers of every kind of size`,
    run: () => {
      const { stderr, status } = run_main(
        optimize ? 'reallocate_optimized' : 'reallocate_debug',
        reallocate,
        optimize,
        reallocate_definitions,
      )
      return [...compare_text('stderr', '', stderr), ...expect_status(0, status)]
    },
  })),
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
      return stops_with('release_queued', 'release of a dropped object', main_body, drop_parent)
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
    // macOS rejects a write of more than INT_MAX bytes at once. The buffer is never touched, so
    // its pages are never made.
    name: 'a write of more than 2 GiB is done whole',
    run: () => {
      const write_large = [
        '  int64_t length = ((int64_t)1 << 31) + 1;',
        '  uint8_t *bytes = malloc((size_t)length);',
        '  int fd = open("/dev/null", O_WRONLY);',
        '  if (bytes == NULL || fd < 0) _exit(2);',
        '  _exit(lerta_os_write(fd, bytes, length) ? 0 : 1);',
      ].join('\n')
      const includes = '#include <fcntl.h>\n#include <stdlib.h>\n#include "internal.h"\n'
      const { stderr, status } = run_main('write_large', write_large, false, includes)
      return [...compare_text('stderr', '', stderr), ...expect_status(0, status)]
    },
  },
  {
    // More than a pipe holds, so that the write finds the pipe full.
    name: 'a write to a non-blocking pipe waits while the pipe is full',
    run: () => {
      const length = 1 << 20
      const write_non_blocking = [
        `  static uint8_t bytes[${length}];`,
        "  memset(bytes, 'x', sizeof bytes);",
        '  fcntl(1, F_SETFL, fcntl(1, F_GETFL) | O_NONBLOCK);',
        '  _exit(lerta_os_write(1, bytes, sizeof bytes) ? 0 : 1);',
      ].join('\n')
      const includes = '#include <fcntl.h>\n#include <string.h>\n#include "internal.h"\n'
      const executable = build_main('write_non_blocking', write_non_blocking, false, includes)
      const run = spawnSync(executable, { maxBuffer: 2 * length })
      return [
        ...compare_text('stdout length', `${length}`, `${run.stdout.length}`),
        ...expect_status(0, run.status),
      ]
    },
  },
  {
    // libuv 1.53.0 took the handle of a spawn that failed while it made the stdio off the loop's
    // queue, and uv_close, which its docs ask for even then, took it off again: with a handle
    // made in between, the loop never ended (see docs/internals.md, on libuv). A TCP handle given
    // as a pipe to make makes uv_spawn fail there.
    name: "libuv's uv_spawn leaves a handle that it fails to spawn to uv_close",
    run: () => {
      const definitions = [
        '#include <stdio.h>',
        '#include <uv.h>',
        'static void count(uv_handle_t *handle, void *walked) { (void)handle; (*(int *)walked)++; }',
        '',
      ].join('\n')
      const spawn_and_close = [
        '  uv_loop_t *loop = uv_default_loop();',
        '  uv_timer_t before, after;',
        '  uv_tcp_t not_a_pipe;',
        '  uv_process_t process;',
        '  uv_timer_init(loop, &before);',
        '  uv_tcp_init(loop, &not_a_pipe);',
        '  char *args[] = {"true", NULL};',
        '  uv_stdio_container_t stdio[2] = {',
        '    {.flags = UV_IGNORE},',
        '    {.flags = UV_CREATE_PIPE | UV_WRITABLE_PIPE, .data.stream = (uv_stream_t *)&not_a_pipe},',
        '  };',
        '  uv_process_options_t options = {.file = "true", .args = args, .stdio_count = 2, .stdio = stdio};',
        '  printf("%s\\n", uv_err_name(uv_spawn(loop, &process, &options)));',
        '  uv_close((uv_handle_t *)&process, NULL);',
        '  uv_timer_init(loop, &after);',
        '  uv_close((uv_handle_t *)&not_a_pipe, NULL);',
        '  uv_run(loop, UV_RUN_DEFAULT);',
        '  int walked = 0;',
        '  uv_walk(loop, count, &walked);',
        '  printf("%d\\n", walked);',
        '  uv_close((uv_handle_t *)&before, NULL);',
        '  uv_close((uv_handle_t *)&after, NULL);',
        '  uv_run(loop, UV_RUN_DEFAULT);',
        '  printf("%d\\n", uv_loop_close(loop));',
        '  fflush(stdout);',
      ].join('\n')
      const executable = build_main('spawn_fails', spawn_and_close, false, definitions)
      const run = spawnSync(executable, { encoding: 'utf8', timeout: 10_000 })
      return [
        ...compare_text('stdout', 'EINVAL\n2\n0\n', run.stdout),
        ...expect_status(0, run.status),
      ]
    },
  },
  {
    name: 'the writes of Writers stay in the buffer, for stderr too, until it is written out',
    run: () => {
      const { stdout, stderr } = run_main('buffered', interleaved_writes('  _exit(0);'), false)
      return [...compare_text('stdout', '', stdout), ...compare_text('stderr', '', stderr)]
    },
  },
  {
    name: 'the buffer is written out at exit, to a terminal too, in the order of the writes',
    run: () => {
      const shown = run_on_terminal(build_main('terminal', interleaved_writes(''), false))
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
