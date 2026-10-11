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
import { root_dir } from './lerta.ts'
import { compare_text, expect_status } from './expect.ts'
import { run_checks, run_suite, type Check } from './report.ts'

const runtime_dir = join(root_dir, 'runtime')
const work_dir = mkdtempSync(join(tmpdir(), 'lerta-runtime-'))

const runtime_c_files = readdirSync(runtime_dir).filter((file) => file.endsWith('.c'))

// The flags of clang_args in compiler/build.lerta, which the compiler cannot apply to C alone.
const runtime_clang_args = (optimize: boolean): string[] => [
  ...(optimize ? ['-O2', '-flto'] : ['-D', 'LERTA_DEBUG']),
  ...runtime_c_files.map((file) => join(runtime_dir, file)),
]

type Outcome = { stdout: string; stderr: string; status: number | null }

// Builds the program and returns the path of its executable.
const build_main = (name: string, main_body: string, optimize: boolean): string => {
  const source = join(work_dir, `${name}.c`)
  const executable = join(work_dir, name)
  const includes = '#include <unistd.h>\n#include "lerta.h"\n'
  writeFileSync(source, `${includes}void lerta_main(void) {\n${main_body}\n}\n`)
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

const run_main = (name: string, main_body: string, optimize: boolean): Outcome => {
  const run = spawnSync(build_main(name, main_body, optimize), { encoding: 'utf8' })
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
      return [...compare_text('stderr', 'leak: 1 object(s)\n', stderr), ...expect_status(1, status)]
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
