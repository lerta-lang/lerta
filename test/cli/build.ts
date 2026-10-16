// Building programs, and what the compiler writes and leaves.
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { compiler, root_dir } from '../lerta.ts'
import { compare_text, expect_status, expect_success } from '../expect.ts'
import type { Check } from '../report.ts'
import {
  build_in_new_dir,
  run_command,
  runtime_flags,
  expect_left,
  hello,
  hello_output,
  new_cache_dir,
  work_dir,
} from './common.ts'

// Building a program with each kind of runtime.
const build_and_run_checks: Check[] = runtime_flags.map((flags) => ({
  name: `lerta build examples/hello.lerta ${[...flags, ''].join(' ')}and run it`,
  run: async () => {
    const executable = join(work_dir, `compiled${flags.join('')}`)
    const args = ['build', hello, '-o', executable, ...flags]
    const built = await run_command(compiler, args)
    if (built.status !== 0) return expect_success('build', built)
    const ran = await run_command(executable, [])
    return [...compare_text('stdout', hello_output, ran.stdout), ...expect_success('run', ran)]
  },
}))

// Outputs that name a file of the build by another path, which the build must leave as it is.
const overwritten_input_cases = [
  { what: 'the source', input: 'hello.lerta', args: ['hello.lerta', '-o', './hello.lerta'] },
  {
    what: 'a linked file',
    input: 'extern.c',
    args: ['hello.lerta', 'extern.c', '-o', 'lib/../extern.c'],
  },
  {
    what: 'an imported module',
    input: 'lib/greeting.lerta',
    args: ['main.lerta', '-o', 'lib/greeting.lerta'],
  },
  {
    what: 'a symlink to the source',
    input: 'hello.lerta',
    args: ['hello.lerta', '-o', 'link.lerta'],
  },
]

const output_checks: Check[] = [
  {
    name: 'lerta build <source> writes the executable to the current directory, and nothing else',
    run: async () => {
      const built = await build_in_new_dir(['build', hello])
      const { status, cwd, left, left_in_temp } = built
      if (status !== 0) return expect_success('build', built)
      const ran = await run_command(join(cwd, 'hello'), [])
      return [
        ...expect_left('files left', ['hello'], left),
        ...expect_left('files left in the temporary directory', [], left_in_temp),
        ...compare_text('stdout', hello_output, ran.stdout),
      ]
    },
  },
  {
    // A path that starts with `-` is given as `./-hi.lerta`, and `-o` takes the next argument as
    // its value whatever it starts with.
    name: 'lerta build ./-hi.lerta -o -hi builds a source and an output whose names start with -',
    run: async () => {
      const cwd = mkdtempSync(join(work_dir, 'cwd-'))
      copyFileSync(hello, join(cwd, '-hi.lerta'))
      const built = await run_command(compiler, ['build', './-hi.lerta', '-o', '-hi'], { cwd })
      if (built.status !== 0) return expect_success('build', built)
      const ran = await run_command(join(cwd, '-hi'), [])
      return [
        ...expect_left('files left', ['-hi', '-hi.lerta'], readdirSync(cwd)),
        ...compare_text('stdout', hello_output, ran.stdout),
      ]
    },
  },
  ...overwritten_input_cases.map(({ what, input, args }) => ({
    name: `lerta build rejects an output that is ${what}`,
    run: async () => {
      const cwd = mkdtempSync(join(work_dir, 'cwd-'))
      mkdirSync(join(cwd, 'lib'))
      copyFileSync(hello, join(cwd, 'hello.lerta'))
      writeFileSync(join(cwd, 'extern.c'), '')
      writeFileSync(
        join(cwd, 'main.lerta'),
        "import greeting from './lib/greeting'\nprint greeting\n",
      )
      writeFileSync(join(cwd, 'lib/greeting.lerta'), "export const greeting = 'hi'\n")
      symlinkSync('hello.lerta', join(cwd, 'link.lerta'))
      const before = readFileSync(join(cwd, input), 'utf8')
      const built = await run_command(compiler, ['build', ...args], { cwd })
      const message = `the output '${args.at(-1)}' is an input of the build\n`
      return [
        ...expect_status(1, built.status),
        ...compare_text('stderr', message, built.stderr),
        ...compare_text(input, before, readFileSync(join(cwd, input), 'utf8')),
      ]
    },
  })),
  {
    name: 'lerta build removes its temporary directory and the runtime when clang fails',
    run: async () => {
      const args = ['build', hello, '-o', 'hello', '--target', 'no-such-target']
      const cache = new_cache_dir()
      const { status, left, left_in_temp } = await build_in_new_dir(args, '', {
        LERTA_CACHE_DIR: cache,
      })
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
    run: async () => {
      const args = ['build', hello, '-o', 'hello']
      const { status, left, left_in_temp } = await build_in_new_dir(args, '', { PATH: work_dir })
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
    run: async () => {
      const source = join(root_dir, 'tests/string/split.lerta')
      const built = await build_in_new_dir(['build', source, '-o', 'split', '-O'])
      const reasons = expect_success('build', built)
      if (reasons.length > 0) return reasons
      // The symbol may stay, as GNU ld's LTO plugin keeps it, but nothing calls it.
      const [disassembler, args] =
        process.platform === 'darwin' ? ['otool', ['-tvV']] : ['objdump', ['-d']]
      const code = await run_command(disassembler, [...args, join(built.cwd, 'split')])
      if (code.status !== 0) return [`${disassembler} failed: ${code.stderr}`]
      return /\b(call\w*|jmp|bl|b)\s.*lerta_retain\b/.test(code.stdout)
        ? ['lerta_retain is not inlined']
        : []
    },
  },
  {
    // The symbols still name the functions; what is left out is the names that traces add.
    name: 'lerta build --no-trace prints an uncaught exception without its trace, whose names it leaves out',
    run: async () => {
      const source = join(root_dir, 'tests/trace/rethrow.lerta')
      const built = await build_in_new_dir(['build', source, '-o', 'rethrow', '-O', '--no-trace'])
      const reasons = expect_success('build', built)
      if (reasons.length > 0) return reasons
      const executable = join(built.cwd, 'rethrow')
      const ran = await run_command(executable, [])
      const program = readFileSync(executable)
      return [
        ...expect_status(1, ran.status),
        ...compare_text('stderr', 'failed\n', ran.stderr),
        ...(program.includes('<top level>') ? ['the program holds the names of traces'] : []),
      ]
    },
  },
  {
    name: 'lerta dump-llvm <source> prints the IR, and writes no file',
    run: async () => {
      const { status, stdout, left, left_in_temp } = await build_in_new_dir(['dump-llvm', hello])
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
    run: async () => {
      const source = join(root_dir, 'tests/module/escaped_path.lerta')
      const { status, stdout } = await build_in_new_dir(['dump-llvm', source])
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
