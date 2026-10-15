// Building programs, and what the compiler writes and leaves.
import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { compiler, root_dir } from '../lerta.ts'
import { compare_text, expect_status, expect_success } from '../expect.ts'
import type { Check } from '../report.ts'
import {
  build_in_new_dir,
  expect_left,
  hello,
  hello_output,
  host_triple,
  new_cache_dir,
  work_dir,
} from './common.ts'

// Building a program, optimized or not, and for a target given as the host's own triple, which
// every host can run.
const build_and_run_checks: Check[] = [[], ['-O'], ['--target', host_triple]].map((flags) => ({
  name: `lerta build examples/hello.lerta ${[...flags, ''].join(' ')}and run it`,
  run: () => {
    const executable = join(work_dir, `compiled${flags.join('')}`)
    const args = ['build', hello, '-o', executable, ...flags]
    const built = spawnSync(compiler, args, { encoding: 'utf8' })
    if (built.status !== 0) return expect_success('build', built)
    const ran = spawnSync(executable, { encoding: 'utf8' })
    return [...compare_text('stdout', hello_output, ran.stdout), ...expect_success('run', ran)]
  },
}))

const output_checks: Check[] = [
  {
    name: 'lerta build <source> writes the executable to the current directory, and nothing else',
    run: () => {
      const built = build_in_new_dir(['build', hello])
      const { status, cwd, left, left_in_temp } = built
      if (status !== 0) return expect_success('build', built)
      const ran = spawnSync(join(cwd, 'hello'), { encoding: 'utf8' })
      return [
        ...expect_left('files left', ['hello'], left),
        ...expect_left('files left in the temporary directory', [], left_in_temp),
        ...compare_text('stdout', hello_output, ran.stdout),
      ]
    },
  },
  {
    name: 'lerta build removes its temporary directory and the runtime when clang fails',
    run: () => {
      const args = ['build', hello, '-o', 'hello', '--target', 'no-such-target']
      const cache = new_cache_dir()
      const { status, left, left_in_temp } = build_in_new_dir(args, '', { LERTA_CACHE_DIR: cache })
      return [
        ...expect_status(1, status),
        ...expect_left('files left', [], left),
        ...expect_left('files left in the temporary directory', [], left_in_temp),
        ...expect_left('files left in the cache', [], readdirSync(cache)),
      ]
    },
  },
  {
    name: 'lerta build removes its temporary directory when clang cannot be started',
    run: () => {
      const args = ['build', hello, '-o', 'hello']
      const { status, left, left_in_temp } = build_in_new_dir(args, '', { PATH: work_dir })
      return [
        ...expect_status(1, status),
        ...expect_left('files left', [], left),
        ...expect_left('files left in the temporary directory', [], left_in_temp),
      ]
    },
  },
  {
    // A program that retains Strings, whose optimized build then has no lerta_retain left, which
    // LLVM can inline only into functions that have the target's attributes.
    name: 'lerta build -O has the runtime inlined into the program',
    run: () => {
      const source = join(root_dir, 'tests/string/split.lerta')
      const built = build_in_new_dir(['build', source, '-o', 'split', '-O'])
      const reasons = expect_success('build', built)
      if (reasons.length > 0) return reasons
      // The symbol may stay, as GNU ld's LTO plugin keeps it, but nothing calls it.
      const [disassembler, args] =
        process.platform === 'darwin' ? ['otool', ['-tvV']] : ['objdump', ['-d']]
      const code = spawnSync(disassembler, [...args, join(built.cwd, 'split')], {
        encoding: 'utf8',
        maxBuffer: 1 << 28,
      })
      if (code.status !== 0) return [`${disassembler} failed: ${code.stderr}`]
      return /\b(call\w*|jmp|bl|b)\s.*lerta_retain\b/.test(code.stdout)
        ? ['lerta_retain is not inlined']
        : []
    },
  },
  {
    name: 'lerta dump-llvm <source> prints the IR, and writes no file',
    run: () => {
      const { status, stdout, left, left_in_temp } = build_in_new_dir(['dump-llvm', hello])
      return [
        ...expect_status(0, status),
        ...(stdout.includes('define external void @lerta_main()')
          ? []
          : [`no lerta_main in:\n${stdout}`]),
        // The target's attributes are a build's, from the cached runtime.
        ...(stdout.includes('attributes #') ? [`attributes in:\n${stdout}`] : []),
        ...expect_left('files left', [], left),
        ...expect_left('files left in the temporary directory', [], left_in_temp),
      ]
    },
  },
  {
    name: 'lerta dump-llvm names symbols by the module paths, escaped',
    run: () => {
      const source = join(root_dir, 'tests/module/escaped_path.lerta')
      const { status, stdout } = build_in_new_dir(['dump-llvm', source])
      const module = 'lib/\\E5\\90\\8D\\E5\\89\\8D \\22a\\5Cb\\22.lerta'
      const expected = [
        `@"lerta.fn.${module}.describe"`,
        `@"lerta.thunk.lerta.fn.${module}.describe"`,
        `@"lerta.method.${module}.Box.doubled"`,
        `@"lerta.extend.${module}.Int.tripled"`,
        `%"lerta.object.${module}.Pair<String>"`,
        '@"lerta.value../escaped_path.lerta.box.set"',
        '@"lerta.fn.std:builtins.print<String>"',
      ]
      return [
        ...expect_status(0, status),
        ...expected.filter((symbol) => !stdout.includes(symbol)).map((symbol) => `no ${symbol}`),
      ]
    },
  },
]

export const build_checks: Check[] = [...build_and_run_checks, ...output_checks]
