// Built programs run with arguments and an environment that the run tests cannot give them.
import { basename, join } from 'node:path'
import { compiler, root_dir } from '../lerta.ts'
import { expect_success, lines } from '../expect.ts'
import type { Check } from '../report.ts'
import { env_with, hello, run_command, shorten_path, work_dir } from './common.ts'

// Runs a built program with arguments of the given bytes. Node passes arguments as UTF-8, so the
// shell makes them.
const run_with_bytes = (executable: string, args: number[][]) => {
  const words = args.map(
    (bytes) => `"$(printf '${bytes.map((b) => `\\${b.toString(8)}`).join('')}')"`,
  )
  return run_command('sh', ['-c', `"$0" ${words.join(' ')}`, executable])
}

const invalid_argument = 'a command-line argument is not valid UTF-8\n'

// The message of an uncaught exception, without the trace that follows it.
const uncaught_message = (stderr: string) => stderr.slice(0, stderr.indexOf('\n') + 1)

// Byte sequences and whether they are UTF-8: the bounds of each length and those around the
// surrogates, then overlong forms, a surrogate, a code point above U+10FFFF, bytes that cannot
// lead, truncated sequences and a lone continuation byte.
const utf8_cases: [number[], boolean][] = [
  [[0x7f], true],
  [[0xc2, 0x80], true],
  [[0xdf, 0xbf], true],
  [[0xe0, 0xa0, 0x80], true],
  [[0xed, 0x9f, 0xbf], true],
  [[0xee, 0x80, 0x80], true],
  [[0xf0, 0x90, 0x80, 0x80], true],
  [[0xf4, 0x8f, 0xbf, 0xbf], true],
  [[0xc0, 0x80], false],
  [[0xc1, 0xbf], false],
  [[0xe0, 0x9f, 0xbf], false],
  [[0xf0, 0x8f, 0xbf, 0xbf], false],
  [[0xed, 0xa0, 0x80], false],
  [[0xf4, 0x90, 0x80, 0x80], false],
  [[0xf5, 0x80, 0x80, 0x80], false],
  [[0xe2, 0x82], false],
  [[0xc3, 0x41], false],
  [[0x80], false],
]

// A source, relative to the repository, and whether the program built from it behaves as it
// should.
type ProgramCase = { source: string; behaves: (executable: string) => Promise<boolean> }

const program_cases: ProgramCase[] = [
  {
    // A built program gets its command-line arguments, which must be valid UTF-8.
    source: 'examples/wc.lerta',
    behaves: async (executable) => {
      const counted = await run_command(executable, [hello])
      const invalid = await run_with_bytes(executable, [[0xff]])
      return (
        counted.stdout === `1 3 21 ${hello}\n` &&
        invalid.status === 1 &&
        uncaught_message(invalid.stderr) === invalid_argument
      )
    },
  },
  {
    // std:process reads the arguments as it runs, even for a program that only uses `exit`.
    source: 'tests/io/lib/exit_only.lerta',
    behaves: async (executable) => {
      const invalid = await run_with_bytes(executable, [[0xff]])
      return invalid.status === 1 && uncaught_message(invalid.stderr) === invalid_argument
    },
  },
  {
    // text() of each argument, which the program reads without decoding it.
    source: 'tests/binary/lib/decode_arguments.lerta',
    behaves: async (executable) => {
      const decoded = await run_with_bytes(
        executable,
        utf8_cases.map(([bytes]) => bytes),
      )
      return decoded.stdout === lines(utf8_cases.map(([, valid]) => String(valid)))
    },
  },
  {
    // env of a value that is not UTF-8 throws; Node passes the environment as UTF-8, so the shell
    // makes the value.
    source: 'tests/process/lib/print_env.lerta',
    behaves: async (executable) => {
      const script = `LERTA_TEST_VALUE="$(printf '\\377')" "$0"`
      const ran = await run_command('sh', ['-c', script, executable])
      const message = 'the environment variable LERTA_TEST_VALUE is not valid UTF-8\n'
      // A variable set to nothing is not nil.
      const env = env_with({ LERTA_TEST_VALUE: '' })
      const empty = await run_command(executable, [], { env })
      const set = env_with({ LERTA_TEST_VALUE: 'héllo' })
      const value = await run_command(executable, [], { env: set })
      return (
        ran.status === 1 &&
        uncaught_message(ran.stderr) === message &&
        empty.stdout === '\n' &&
        value.stdout === 'héllo\n'
      )
    },
  },
  {
    // run captures through a pipe that may be fd 1, when the program starts with stdout closed.
    source: 'tests/process/lib/capture_without_stdout.lerta',
    behaves: async (executable) => {
      const ran = await run_command('sh', ['-c', '"$0" >&-', executable])
      return ran.status === 0 && ran.stderr === 'true\n'
    },
  },
]

export const program_checks: Check[] = program_cases.map(({ source, behaves }) => {
  const executable = join(work_dir, basename(source, '.lerta'))
  const args = ['build', join(root_dir, source), '-o', executable]
  return {
    name: `lerta ${args.map(shorten_path).join(' ')} and run it`,
    run: async () => {
      const built = await run_command(compiler, args)
      if (built.status !== 0) return expect_success('build', built)
      return (await behaves(executable)) ? [] : ['the program does not behave as it should']
    },
  }
})
