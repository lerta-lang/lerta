// CLI checks: each invocation of the compiler's command line (see lerta.ts) and its expected exit
// status.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { compiler, root_dir } from './lerta.ts'
import { compare_text, run_checks } from './report.ts'

const cli_work_dir = mkdtempSync(join(tmpdir(), 'lerta-cli-'))
const hello = join(root_dir, 'examples/hello.lerta')
const exe = join(cli_work_dir, 'hello')
const dump_checked_source = join(root_dir, 'tests/module/dump_checked.lerta')
const hello_output = readFileSync(join(root_dir, 'tests/examples/hello.out'), 'utf8')
const root = ['--root', root_dir]
const host_triple = spawnSync('clang', ['-print-target-triple'], { encoding: 'utf8' }).stdout.trim()
type CliCase = {
  args: string[]
  status: number
  stdout?: string
  stderr?: string
  produced?: () => boolean
}

// Runs a built program with arguments of the given bytes. Node passes arguments as UTF-8, so the
// shell makes them.
const run_with_bytes = (executable: string, args: number[][]) => {
  const words = args.map(
    (bytes) => `"$(printf '${bytes.map((b) => `\\${b.toString(8)}`).join('')}')"`,
  )
  return spawnSync('sh', ['-c', `"$0" ${words.join(' ')}`, executable], { encoding: 'utf8' })
}

const invalid_argument = 'a command-line argument is not valid UTF-8\n'

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

const cli_cases: CliCase[] = [
  {
    args: ['build', hello, '-o', `${exe}_O`, '-O', '--emit-llvm', `${exe}_O.ll`, ...root],
    status: 0,
    produced: () =>
      spawnSync(`${exe}_O`, { encoding: 'utf8' }).stdout === hello_output &&
      existsSync(`${exe}_O.ll`),
  },
  {
    // A built program gets its command-line arguments, which must be valid UTF-8.
    args: ['build', join(root_dir, 'examples/wc.lerta'), '-o', `${exe}_wc`, ...root],
    status: 0,
    produced: () => {
      const counted = spawnSync(`${exe}_wc`, [hello], { encoding: 'utf8' })
      const invalid = run_with_bytes(`${exe}_wc`, [[0xff]])
      return (
        counted.stdout === `1 3 21 ${hello}\n` &&
        invalid.status === 1 &&
        invalid.stderr === invalid_argument
      )
    },
  },
  {
    // std:process reads the arguments as it runs, even for a program that only uses `exit`.
    args: ['build', join(root_dir, 'tests/io/lib/exit_only.lerta'), '-o', `${exe}_exit`, ...root],
    status: 0,
    produced: () => {
      const invalid = run_with_bytes(`${exe}_exit`, [[0xff]])
      return invalid.status === 1 && invalid.stderr === invalid_argument
    },
  },
  {
    // decode_utf8 of each argument, which the program reads without decoding it.
    args: [
      'build',
      join(root_dir, 'tests/binary/lib/decode_arguments.lerta'),
      '-o',
      `${exe}_utf8`,
      ...root,
    ],
    status: 0,
    produced: () => {
      const decoded = run_with_bytes(
        `${exe}_utf8`,
        utf8_cases.map(([bytes]) => bytes),
      )
      return decoded.stdout === utf8_cases.map(([, valid]) => `${valid}\n`).join('')
    },
  },
  {
    args: ['build', join(root_dir, 'tests/name/undefined.lerta'), '-o', exe, ...root],
    status: 1,
    stderr: `${join(root_dir, 'tests/name/undefined.lerta')}:1:1: undefined name 'say'\n`,
  },
  {
    args: ['build', root_dir, '-o', exe, ...root],
    status: 1,
    stderr: `'${root_dir}' is not a file\n`,
  },
  {
    args: ['build', join(cli_work_dir, 'missing.lerta'), '-o', exe, ...root],
    status: 1,
    stderr: `'${join(cli_work_dir, 'missing.lerta')}' is not a file\n`,
  },
  {
    // Without -o, only the IR is written.
    args: ['build', hello, '--emit-llvm', `${exe}_ir.ll`, ...root],
    status: 0,
    produced: () => readFileSync(`${exe}_ir.ll`, 'utf8').includes('define void @lerta_main()'),
  },
  { args: ['build', ...root], status: 2 },
  { args: ['build', hello, ...root], status: 2 },
  { args: ['build', hello, '-O', '--emit-llvm', `${exe}_ir.ll`, ...root], status: 2 },
  { args: ['run', hello, '-o', exe], status: 2 },
  { args: ['build', hello, '-o', exe, '-o', exe, ...root], status: 2 },
  { args: ['build', hello, '-o', exe, '-O', '-O', ...root], status: 2 },
  { args: ['build', hello, '-o', '-O', ...root], status: 2 },
  { args: ['build', hello, '-o', exe, '--emit-llvm', ...root], status: 2 },
  { args: ['build', hello, hello, '-o', exe, ...root], status: 2 },
  { args: ['build', hello, '-o', exe, '--unknown', ...root], status: 2 },
  { args: ['build', hello, '--emit-llvm', `${exe}_ir.ll`], status: 2 },
  { args: ['build', hello, '-o', exe, ...root, ...root], status: 2 },
  {
    args: ['build', hello, '--target', host_triple, '--emit-llvm', `${exe}_ir.ll`, ...root],
    status: 2,
  },
  {
    args: ['build', hello, '-o', exe, '--target', host_triple, '--target', host_triple, ...root],
    status: 2,
  },
  { args: ['dump-checked', hello], status: 2 },
  {
    args: ['dump-tokens', hello],
    status: 0,
    stdout: [
      '1:1 spaced IDENTIFIER "print"',
      '1:7 spaced STRING "hello, world"',
      '1:21 spaced NEWLINE ""',
      '2:1 spaced EOF ""',
    ]
      .map((line) => `${line}\n`)
      .join(''),
  },
  {
    // An integer, an interpolation, an indented block, brackets over lines, keywords and punctuation.
    args: ['dump-tokens', join(root_dir, 'tests/lex/dump_tokens.lerta')],
    status: 0,
    stdout: [
      '1:1 spaced const "const"',
      '1:7 spaced IDENTIFIER "twice"',
      '1:13 spaced = "="',
      '1:15 spaced ( "("',
      '1:16 joined IDENTIFIER "n"',
      '1:17 joined : ":"',
      '1:19 spaced IDENTIFIER "Int"',
      '1:22 joined ) ")"',
      '1:24 spaced -> "->"',
      '1:26 spaced NEWLINE ""',
      '2:3 spaced INDENT ""',
      '2:3 spaced var "var"',
      '2:7 spaced IDENTIFIER "total"',
      '2:13 spaced = "="',
      '2:15 spaced IDENTIFIER "n"',
      '2:16 spaced NEWLINE ""',
      '3:3 spaced IDENTIFIER "total"',
      '3:9 spaced += "+="',
      '3:12 spaced IDENTIFIER "n"',
      '3:13 spaced NEWLINE ""',
      '4:3 spaced IDENTIFIER "total"',
      '4:8 spaced NEWLINE ""',
      '5:1 spaced DEDENT ""',
      '5:1 spaced const "const"',
      '5:7 spaced IDENTIFIER "xs"',
      '5:10 spaced = "="',
      '5:12 spaced [ "["',
      '5:13 spaced LINE_BREAK ""',
      '6:3 spaced IDENTIFIER "twice"',
      '6:8 joined ( "("',
      '6:9 joined INTEGER "1"',
      '6:10 joined ) ")"',
      '6:11 joined , ","',
      '6:13 spaced INTEGER "0x10"',
      '6:17 spaced LINE_BREAK ""',
      '7:1 spaced ] "]"',
      '7:2 spaced NEWLINE ""',
      '8:1 spaced IDENTIFIER "print"',
      '8:7 spaced INTERPOLATED ""',
      '  code 10 "xs.length"',
      '  text " items"',
      '8:27 spaced NEWLINE ""',
      '9:1 spaced EOF ""',
    ]
      .map((line) => `${line}\n`)
      .join(''),
  },
  {
    args: ['dump-tokens', join(root_dir, 'tests/lex/column_code_points.lerta')],
    status: 1,
    stderr: `${join(root_dir, 'tests/lex/column_code_points.lerta')}:1:8: unexpected character '$'\n`,
  },
  { args: ['dump-tokens', root_dir], status: 1, stderr: `'${root_dir}' is not a file\n` },
  {
    args: ['dump-tokens', join(cli_work_dir, 'missing.lerta')],
    status: 1,
    stderr: `'${join(cli_work_dir, 'missing.lerta')}' is not a file\n`,
  },
  { args: ['dump-ast', root_dir], status: 1, stderr: `'${root_dir}' is not a file\n` },
  { args: ['dump-tokens'], status: 2 },
  {
    args: ['dump-ast', hello],
    status: 0,
    stdout: [
      '-',
      '  call 1:1',
      '    args:',
      '      -',
      '        string 1:7',
      '          value: "hello, world"',
      '    callee:',
      '      identifier 1:1',
      '        name: "print"',
      '    named_args: []',
      '    type_args: []',
    ]
      .map((line) => `${line}\n`)
      .join(''),
  },
  {
    // An export, an unset optional field and an interpolation, whose parts are a value and a node.
    args: ['dump-ast', join(root_dir, 'tests/parse/dump.lerta')],
    status: 0,
    stdout: [
      '-',
      '  declaration 1:8',
      '    exported: true',
      '    mutable: false',
      '    name:',
      '      identifier 1:14',
      '        name: "greet"',
      '    type: -',
      '    value:',
      '      function 1:22',
      '        body:',
      '          -',
      '            call 1:52',
      '              args:',
      '                -',
      '                  interpolation 1:58',
      '                    parts:',
      '                      - "hi "',
      '                      -',
      '                        call 1:64',
      '                          args: []',
      '                          callee:',
      '                            member 1:64',
      '                              name:',
      '                                identifier 1:64',
      '                                  name: "to_string"',
      '                              object:',
      '                                conditional 1:64',
      '                                  condition:',
      '                                    identifier 1:64',
      '                                      name: "name"',
      '                                  else_value:',
      '                                    string 1:90',
      '                                      value: "you"',
      '                                  then_value:',
      '                                    member 1:74',
      '                                      name:',
      '                                        identifier 1:79',
      '                                          name: "first"',
      '                                      object:',
      '                                        identifier 1:74',
      '                                          name: "name"',
      '                          named_args: []',
      '                          type_args: []',
      '              callee:',
      '                identifier 1:52',
      '                  name: "print"',
      '              named_args: []',
      '              type_args: []',
      '        params:',
      '          -',
      '            name:',
      '              identifier 1:23',
      '                name: "name"',
      '            type:',
      '              record_type 1:29',
      '                fields:',
      '                  -',
      '                    name:',
      '                      identifier 1:31',
      '                        name: "first"',
      '                    type:',
      '                      type_name 1:38',
      '                        args: []',
      '                        name: "String"',
      '                        optional: false',
      '                optional: true',
      '        return_type: -',
      '        type_params: []',
      '-',
      '  call 2:1',
      '    args:',
      '      -',
      '        nil 2:7',
      '    callee:',
      '      identifier 2:1',
      '        name: "greet"',
      '    named_args: []',
      '    type_args: []',
    ]
      .map((line) => `${line}\n`)
      .join(''),
  },
  {
    args: ['dump-ast', join(root_dir, 'tests/parse/dangling_operator.lerta')],
    status: 1,
    stderr: `${join(root_dir, 'tests/parse/dangling_operator.lerta')}:1:10: expected expression, found end of line\n`,
  },
  { args: ['dump-ast', hello, hello], status: 2 },
  { args: ['dump-tokens', hello, hello], status: 2 },
  {
    // Modules in an import cycle, in the order they load; a warning; a conversion, of the Int passed
    // as an Int?; a method of an extend; and a generic function, whose body has no types.
    args: ['dump-checked', dump_checked_source, ...root],
    status: 0,
    stdout: [
      'module lib/given_back.lerta',
      '-',
      '  import 1:1',
      '    module: "std:builtins"',
      '    names: []',
      '-',
      '  import 1:1',
      '    module: "./given"',
      '    names: []',
      'module lib/given.lerta',
      '-',
      '  import 1:1',
      '    module: "std:builtins"',
      '    names: []',
      '-',
      '  import 1:1',
      '    module: "./given_back"',
      '    names: []',
      '-',
      '  declaration 2:8',
      '    exported: true',
      '    mutable: false',
      '    name:',
      '      identifier 2:14',
      '        name: "is_given"',
      '    type: -',
      '    value:',
      '      function 2:25 : (Int?) -> Bool',
      '        body:',
      '          -',
      '            binary 2:44 : Bool',
      '              left:',
      '                identifier 2:44 : Int?',
      '                  name: "n"',
      '              operator: "!="',
      '              right:',
      '                nil 2:49 : nil',
      '        params:',
      '          -',
      '            name:',
      '              identifier 2:26 : Int?',
      '                name: "n"',
      '            type:',
      '              type_name 2:29',
      '                args: []',
      '                name: "Int"',
      '                optional: true',
      '        return_type:',
      '          type_name 2:36',
      '            args: []',
      '            name: "Bool"',
      '            optional: false',
      '        type_params: []',
      `module ${dump_checked_source}`,
      '-',
      '  import 1:1',
      '    module: "std:builtins"',
      '    names: []',
      '-',
      '  import 1:1',
      '    module: "./lib/given"',
      '    names:',
      '      -',
      '        alias: -',
      '        name:',
      '          identifier 1:10',
      '            name: "is_given"',
      '-',
      '  declaration 2:1',
      '    exported: false',
      '    mutable: false',
      '    name:',
      '      identifier 2:7 : Int',
      '        name: "unused"',
      '    type: -',
      '    value:',
      '      integer 2:16 : Int',
      '        value: 1',
      '-',
      '  declaration 3:1',
      '    exported: false',
      '    mutable: false',
      '    name:',
      '      identifier 3:7',
      '        name: "id"',
      '    type: -',
      '    value:',
      '      function 3:12',
      '        body:',
      '          -',
      '            identifier 3:28',
      '              name: "x"',
      '        params:',
      '          -',
      '            name:',
      '              identifier 3:16',
      '                name: "x"',
      '            type:',
      '              type_name 3:19',
      '                args: []',
      '                name: "T"',
      '                optional: false',
      '        return_type:',
      '          type_name 3:23',
      '            args: []',
      '            name: "T"',
      '            optional: false',
      '        type_params:',
      '          -',
      '            bound: -',
      '            name:',
      '              identifier 3:13',
      '                name: "T"',
      '-',
      '  extend 4:1',
      '    members:',
      '      -',
      '        column: 3',
      '        line: 5',
      '        modifier: -',
      '        name:',
      '          identifier 5:3',
      '            name: "twice"',
      '        type: -',
      '        value:',
      '          function 5:11 : () -> Int',
      '            body:',
      '              -',
      '                binary 5:22 : Int',
      '                  left:',
      '                    this 5:22 : Int',
      '                  operator: "*"',
      '                  right:',
      '                    integer 5:26 : Int',
      '                      value: 2',
      '            params: []',
      '            return_type:',
      '              type_name 5:15',
      '                args: []',
      '                name: "Int"',
      '                optional: false',
      '            type_params: []',
      '    type:',
      '      type_name 4:8',
      '        args: []',
      '        name: "Int"',
      '        optional: false',
      '    type_params: []',
      '-',
      '  call 6:1 : void',
      '    args:',
      '      -',
      '        call 6:7 : Bool',
      '          args:',
      '            -',
      '              call 6:16 : Int => Int?',
      '                args: []',
      '                callee:',
      '                  member 6:16 : () -> Int',
      '                    name:',
      '                      identifier 6:22',
      '                        name: "twice"',
      '                    object:',
      '                      call 6:16 : Int',
      '                        args:',
      '                          -',
      '                            integer 6:19 : Int',
      '                              value: 2',
      '                        callee:',
      '                          identifier 6:16',
      '                            name: "id"',
      '                        named_args: []',
      '                        type_args: []',
      '                named_args: []',
      '                type_args: []',
      '          callee:',
      '            identifier 6:7 : (Int?) -> Bool',
      '              name: "is_given"',
      '          named_args: []',
      '          type_args: []',
      '    callee:',
      '      identifier 6:1',
      '        name: "print"',
      '    named_args: []',
      '    type_args: []',
    ]
      .map((line) => `${line}\n`)
      .join(''),
    stderr: `${dump_checked_source}:2:7: warning: 'unused' is never used\n`,
  },
  {
    args: ['dump-checked', join(root_dir, 'tests/name/undefined.lerta'), ...root],
    status: 1,
    stderr: `${join(root_dir, 'tests/name/undefined.lerta')}:1:1: undefined name 'say'\n`,
  },
  { args: ['dump-checked', hello, hello, ...root], status: 2 },
]
// Paths are shown relative to the repository, and the work directory as <tmp>.
const shorten_path = (arg: string): string =>
  arg.replace(cli_work_dir, '<tmp>').replace(`${root_dir}/`, '').replace(root_dir, '<root>')

const run_cli_case = ({ args, status, stdout, stderr, produced }: CliCase): string[] => {
  const actual = spawnSync(compiler, args, { encoding: 'utf8' })
  if (actual.status !== status) return [`expected exit status ${status}, got ${actual.status}`]
  if (stdout !== undefined && actual.stdout !== stdout)
    return [`unexpected stdout: ${actual.stdout}`]
  if (stderr !== undefined && actual.stderr !== stderr)
    return [`unexpected stderr: ${actual.stderr}`]
  if (produced !== undefined && !produced()) return ['the build did not produce what it should']
  return []
}

// A program does not report the warnings of the standard modules, so each is built on its own,
// where they are its warnings, and must have none.
const std_dir = join(root_dir, 'std')
const std_checks = readdirSync(std_dir).map((file) => ({
  name: `std/${file} builds without warnings`,
  run: () => {
    const args = ['build', join(std_dir, file), '-o', join(cli_work_dir, file), ...root]
    const { status, stderr } = spawnSync(compiler, args, { encoding: 'utf8' })
    return status === 0 && stderr === '' ? [] : [`exit status ${status}, stderr:\n${stderr}`]
  },
}))

// Building a program, optimized or not, and for a target given as the host's own triple, which
// every host can run.
const build_and_run_checks = [[], ['-O'], ['--target', host_triple]].map((flags) => ({
  name: `lerta build examples/hello.lerta ${[...flags, ''].join(' ')}and run it`,
  run: () => {
    const executable = join(cli_work_dir, `compiled${flags.join('')}`)
    const args = ['build', hello, '-o', executable, ...flags, ...root]
    const built = spawnSync(compiler, args, { encoding: 'utf8' })
    if (built.status !== 0) return [`build exit status ${built.status}, stderr:\n${built.stderr}`]
    const ran = spawnSync(executable, { encoding: 'utf8' })
    const status_reasons =
      ran.status === 0 ? [] : [`exit status ${ran.status}, stderr:\n${ran.stderr}`]
    return [...compare_text('stdout', hello_output, ran.stdout), ...status_reasons]
  },
}))

let failed_count: number
try {
  failed_count = await run_checks('CLI checks', [
    ...cli_cases.map((cli_case) => ({
      name: `lerta ${cli_case.args.map(shorten_path).join(' ')}`,
      run: () => run_cli_case(cli_case),
    })),
    ...std_checks,
    ...build_and_run_checks,
  ])
} finally {
  rmSync(cli_work_dir, { recursive: true, force: true })
}
process.exit(failed_count === 0 ? 0 : 1)
