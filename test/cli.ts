// CLI checks: each invocation of the compiler's command line (see lerta.ts) and its expected exit
// status.
import { spawnSync, type StdioOptions } from 'node:child_process'
import { closeSync, mkdtempSync, openSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { compiler, root_dir } from './lerta.ts'
import { compare_text, expect_status, expect_success, lines } from './expect.ts'
import { run_checks, run_suite } from './report.ts'

const cli_work_dir = mkdtempSync(join(tmpdir(), 'lerta-cli-'))
const hello = join(root_dir, 'examples/hello.lerta')
const exe = join(cli_work_dir, 'hello')
const dump_checked_source = join(root_dir, 'tests/module/dump_checked.lerta')
const hello_output = readFileSync(join(root_dir, 'tests/examples/hello.out'), 'utf8')
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
    // A built program gets its command-line arguments, which must be valid UTF-8.
    args: ['build', join(root_dir, 'examples/wc.lerta'), '-o', `${exe}_wc`],
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
    args: ['build', join(root_dir, 'tests/io/lib/exit_only.lerta'), '-o', `${exe}_exit`],
    status: 0,
    produced: () => {
      const invalid = run_with_bytes(`${exe}_exit`, [[0xff]])
      return invalid.status === 1 && invalid.stderr === invalid_argument
    },
  },
  {
    // text() of each argument, which the program reads without decoding it.
    args: ['build', join(root_dir, 'tests/binary/lib/decode_arguments.lerta'), '-o', `${exe}_utf8`],
    status: 0,
    produced: () => {
      const decoded = run_with_bytes(
        `${exe}_utf8`,
        utf8_cases.map(([bytes]) => bytes),
      )
      return decoded.stdout === lines(utf8_cases.map(([, valid]) => String(valid)))
    },
  },
  {
    args: ['build', join(root_dir, 'tests/name/undefined.lerta'), '-o', exe],
    status: 1,
    stderr: `${join(root_dir, 'tests/name/undefined.lerta')}:1:1: undefined name 'say'\n`,
  },
  {
    args: ['build', root_dir, '-o', exe],
    status: 1,
    stderr: `'${root_dir}' is not a file\n`,
  },
  {
    args: ['build', join(cli_work_dir, 'missing.lerta'), '-o', exe],
    status: 1,
    stderr: `'${join(cli_work_dir, 'missing.lerta')}' is not a file\n`,
  },
  {
    // -Werror stops the build at a warning, as at an error, after printing the warnings.
    args: ['build', join(root_dir, 'tests/variable/unused.lerta'), '-o', exe, '-Werror'],
    status: 1,
    stderr: lines([
      `${join(root_dir, 'tests/variable/unused.lerta')}:1:7: warning: 'unused' is never used`,
      `${join(root_dir, 'tests/variable/unused.lerta')}:6:7: warning: 'inner' is never used`,
    ]),
  },
  {
    // lerta run with -Werror runs nothing after the warnings.
    args: ['run', join(root_dir, 'tests/variable/unused.lerta'), '-Werror'],
    status: 1,
    stdout: '',
    stderr: lines([
      `${join(root_dir, 'tests/variable/unused.lerta')}:1:7: warning: 'unused' is never used`,
      `${join(root_dir, 'tests/variable/unused.lerta')}:6:7: warning: 'inner' is never used`,
    ]),
  },
  { args: ['build'], status: 2 },
  { args: ['build', hello, '-o', exe, '-Werror', '-Werror'], status: 2 },
  { args: ['build', hello, '-o', exe, '-o', exe], status: 2 },
  { args: ['build', hello, '-o', exe, '-O', '-O'], status: 2 },
  { args: ['build', hello, '-o', '-O'], status: 2 },
  { args: ['build', hello, '-o'], status: 2 },
  { args: ['build', hello, hello, '-o', exe], status: 2 },
  { args: ['build', hello, join(root_dir, 'README.md'), '-o', exe], status: 2 },
  { args: ['dump-llvm', hello, join(root_dir, 'tests/extern/lib/twice.c')], status: 2 },
  { args: ['build', hello, '-o', exe, '--unknown'], status: 2 },
  {
    args: ['build', hello, '-o', exe, '--target', host_triple, '--target', host_triple],
    status: 2,
  },
  // Options that the compiler no longer has.
  { args: ['build', hello, '-o', exe, '--root', root_dir], status: 2 },
  { args: ['build', hello, '-o', exe, '--emit-llvm', `${exe}.ll`], status: 2 },
  // Without -o, the output is named after the source, which must end with .lerta.
  { args: ['build', join(root_dir, 'README.md')], status: 2 },
  { args: ['build', join(root_dir, 'tests/.lerta')], status: 2 },
  { args: ['dump-llvm'], status: 2 },
  { args: ['run'], status: 2 },
  { args: ['run', '--', 'a'], status: 2 },
  { args: ['run', hello, '-o', exe], status: 2 },
  { args: ['run', hello, '--target', host_triple], status: 2 },
  { args: ['run', hello, join(root_dir, 'README.md')], status: 2 },
  { args: ['run', hello, 'a'], status: 2 },
  { args: ['build', hello, '-o', exe, '--', 'a'], status: 2 },
  // A standard module is a source too, as the compiler carries it.
  {
    args: ['dump-tokens', 'std:process'],
    status: 0,
  },
  {
    args: ['dump-ast', 'std:nothing'],
    status: 1,
    stderr: "unknown standard module 'std:nothing'\n",
  },
  { args: ['build', 'std:process'], status: 2 },
  { args: ['dump-llvm', hello, hello], status: 2 },
  { args: ['dump-llvm', hello, '-O'], status: 2 },
  {
    args: ['dump-llvm', join(root_dir, 'tests/name/undefined.lerta')],
    status: 1,
    stderr: `${join(root_dir, 'tests/name/undefined.lerta')}:1:1: undefined name 'say'\n`,
  },
  { args: ['dump-checked', hello, '--root', root_dir], status: 2 },
  {
    args: ['dump-tokens', hello],
    status: 0,
    stdout: lines([
      '1:1 spaced IDENTIFIER "print"',
      '1:7 spaced STRING "hello, world"',
      '1:21 spaced NEWLINE ""',
      '2:1 spaced EOF ""',
    ]),
  },
  {
    // An integer, an interpolation, an indented block, brackets over lines, keywords and punctuation.
    args: ['dump-tokens', join(root_dir, 'tests/lex/dump_tokens.lerta')],
    status: 0,
    stdout: lines([
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
    ]),
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
    stdout: lines([
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
    ]),
  },
  {
    // An export, an unset optional field and an interpolation, whose parts are a value and a node.
    args: ['dump-ast', join(root_dir, 'tests/parse/dump.lerta')],
    status: 0,
    stdout: lines([
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
      '                                  without_else: false',
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
    ]),
  },
  {
    // A cast that gives nil, `as?`, and one that throws, `as!`, which keep the type's `?` apart.
    args: ['dump-ast', join(root_dir, 'tests/parse/cast_dump.lerta')],
    status: 0,
    stdout: lines([
      '-',
      '  call 1:1',
      '    args:',
      '      -',
      '        as? 1:7',
      '          type:',
      '            type_name 1:12',
      '              args: []',
      '              name: "A"',
      '              optional: true',
      '          value:',
      '            integer 1:7',
      '              value: 1',
      '    callee:',
      '      identifier 1:1',
      '        name: "print"',
      '    named_args: []',
      '    type_args: []',
      '-',
      '  call 2:1',
      '    args:',
      '      -',
      '        as! 2:7',
      '          type:',
      '            type_name 2:12',
      '              args: []',
      '              name: "B"',
      '              optional: false',
      '          value:',
      '            integer 2:7',
      '              value: 1',
      '    callee:',
      '      identifier 2:1',
      '        name: "print"',
      '    named_args: []',
      '    type_args: []',
    ]),
  },
  {
    // An interface with a type parameter, whose members are written as a class's.
    args: ['dump-ast', join(root_dir, 'tests/parse/interface_dump.lerta')],
    status: 0,
    stdout: lines([
      '-',
      '  interface 1:8',
      '    exported: true',
      '    members:',
      '      -',
      '        column: 3',
      '        line: 2',
      '        modifier: -',
      '        name:',
      '          identifier 2:3',
      '            name: "area"',
      '        type:',
      '          function_type 2:9',
      '            optional: false',
      '            params: []',
      '            result:',
      '              type_name 2:15',
      '                args: []',
      '                name: "T"',
      '                optional: false',
      '        value: -',
      '    name:',
      '      identifier 1:18',
      '        name: "Shape"',
      '    type_params:',
      '      -',
      '        bound: -',
      '        name:',
      '          identifier 1:24',
      '            name: "T"',
    ]),
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
    args: ['dump-checked', dump_checked_source],
    status: 0,
    stdout: lines([
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
    ]),
    stderr: `${dump_checked_source}:2:7: warning: 'unused' is never used\n`,
  },
  {
    args: ['dump-checked', join(root_dir, 'tests/name/undefined.lerta')],
    status: 1,
    stderr: `${join(root_dir, 'tests/name/undefined.lerta')}:1:1: undefined name 'say'\n`,
  },
  { args: ['dump-checked', hello, hello], status: 2 },
]
// Paths are shown relative to the repository, and the work directory as <tmp>.
const shorten_path = (arg: string): string =>
  arg.replace(cli_work_dir, '<tmp>').replace(`${root_dir}/`, '').replace(root_dir, '<root>')

const run_cli_case = ({ args, status, stdout, stderr, produced }: CliCase): string[] => {
  const actual = spawnSync(compiler, args, { encoding: 'utf8' })
  if (actual.status !== status) return expect_status(status, actual.status)
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
const std_modules = readdirSync(std_dir).map((file) => `std:${file.replace(/\.lerta$/, '')}`)
const std_checks = std_modules.map((module) => ({
  name: `${module} builds without warnings`,
  run: () => {
    const args = ['build', module, '-o', join(cli_work_dir, module.replace(':', '_')), '-Werror']
    const built = spawnSync(compiler, args, { encoding: 'utf8' })
    if (built.status !== 0) return expect_success('build', built)
    return compare_text('stderr', '', built.stderr)
  },
}))

// Building a program, optimized or not, and for a target given as the host's own triple, which
// every host can run.
const build_and_run_checks = [[], ['-O'], ['--target', host_triple]].map((flags) => ({
  name: `lerta build examples/hello.lerta ${[...flags, ''].join(' ')}and run it`,
  run: () => {
    const executable = join(cli_work_dir, `compiled${flags.join('')}`)
    const args = ['build', hello, '-o', executable, ...flags]
    const built = spawnSync(compiler, args, { encoding: 'utf8' })
    if (built.status !== 0) return expect_success('build', built)
    const ran = spawnSync(executable, { encoding: 'utf8' })
    return [...compare_text('stdout', hello_output, ran.stdout), ...expect_success('run', ran)]
  },
}))

// Runs the compiler in a new directory, with another new one as the system's directory for
// temporary files, and returns what it left in each. `path`, if given, is the PATH it runs with.
// stdin is a file of `input`: on Linux, Node gives a child a socket for a pipe, which
// /dev/stdin cannot open.
const build_in_new_dir = (args: string[], input = '', path?: string) => {
  const cwd = mkdtempSync(join(cli_work_dir, 'cwd-'))
  const temp = mkdtempSync(join(cli_work_dir, 'temp-'))
  const input_path = join(cli_work_dir, `${basename(cwd)}.in`)
  writeFileSync(input_path, input)
  const stdin = openSync(input_path, 'r')
  const env = { ...process.env, TMPDIR: temp, ...(path === undefined ? {} : { PATH: path }) }
  const stdio: StdioOptions = [stdin, 'pipe', 'pipe']
  const built = spawnSync(compiler, args, { cwd, env, stdio, encoding: 'utf8' })
  closeSync(stdin)
  return { ...built, cwd, left: readdirSync(cwd), left_in_temp: readdirSync(temp) }
}

const expect_left = (what: string, expected: string[], actual: string[]): string[] =>
  compare_text(what, lines(expected), lines(actual.toSorted()))

const output_checks = [
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
    name: 'lerta build removes its temporary directory when clang fails',
    run: () => {
      const args = ['build', hello, '-o', 'hello', '--target', 'no-such-target']
      const { status, left, left_in_temp } = build_in_new_dir(args)
      return [
        ...expect_status(1, status),
        ...expect_left('files left', [], left),
        ...expect_left('files left in the temporary directory', [], left_in_temp),
      ]
    },
  },
  {
    name: 'lerta build removes its temporary directory when clang cannot be started',
    run: () => {
      const args = ['build', hello, '-o', 'hello']
      const { status, left, left_in_temp } = build_in_new_dir(args, '', cli_work_dir)
      return [
        ...expect_status(1, status),
        ...expect_left('files left', [], left),
        ...expect_left('files left in the temporary directory', [], left_in_temp),
      ]
    },
  },
  {
    name: 'lerta dump-llvm <source> prints the IR, and writes no file',
    run: () => {
      const { status, stdout, left, left_in_temp } = build_in_new_dir(['dump-llvm', hello])
      return [
        ...expect_status(0, status),
        ...(stdout.includes('define void @lerta_main()') ? [] : [`no lerta_main in:\n${stdout}`]),
        ...expect_left('files left', [], left),
        ...expect_left('files left in the temporary directory', [], left_in_temp),
      ]
    },
  },
]

// A program with an extern of its own, linked with its C function in each form that clang takes,
// unoptimized and optimized, which compiles C with -flto too. The object and the archive are
// built without -flto, which the optimized build must link as well.
const twice_dir = join(root_dir, 'tests/extern/lib')
const twice_source = join(twice_dir, 'twice.lerta')
const twice_c = join(twice_dir, 'twice.c')
// Each check makes its inputs under names of its own, `name`, since the checks may run at once.
const twice_inputs: [string, (name: string) => string][] = [
  ['.c', () => twice_c],
  ['.o', (name) => compile_c(['-c'], `${name}.o`)],
  ['.ll', (name) => compile_c(['-S', '-emit-llvm'], `${name}.ll`)],
  ['.a', (name) => archive(compile_c(['-c'], `${name}.o`), `${name}.a`)],
]

// Runs a tool that makes an input, and throws, which fails the check, if it fails.
const run_tool = (command: string, args: string[]): void => {
  const ran = spawnSync(command, args, { encoding: 'utf8' })
  const reasons = expect_success(command, ran)
  if (reasons.length > 0) throw new Error(reasons.join('\n'))
}

const compile_c = (flags: string[], name: string): string => {
  const output = join(cli_work_dir, name)
  run_tool('clang', [...flags, twice_c, '-o', output])
  return output
}

const archive = (object: string, name: string): string => {
  const output = join(cli_work_dir, name)
  run_tool('ar', ['rcs', output, object])
  return output
}

// Builds twice.lerta with `file` linked, from `cwd`, and runs it.
const build_twice = (file: string, flags: string[], cwd: string, name: string): string[] => {
  const executable = join(cli_work_dir, name)
  const args = ['build', twice_source, file, '-o', executable, ...flags]
  const built = spawnSync(compiler, args, { cwd, encoding: 'utf8' })
  if (built.status !== 0) return expect_success('build', built)
  const ran = spawnSync(executable, { encoding: 'utf8' })
  return [...compare_text('stdout', '42\n', ran.stdout), ...expect_success('run', ran)]
}

const linked_file_checks = [
  ...twice_inputs.flatMap(([extension, make_input]) =>
    [[], ['-O']].map((flags) => ({
      name: `lerta build <source> <file${extension}> ${[...flags, ''].join(' ')}links the file`,
      run: () => {
        const name = `twice${extension}${flags.join('')}`
        return build_twice(make_input(`${name}_input`), flags, cli_work_dir, name)
      },
    })),
  ),
  {
    name: 'lerta build <source> <file> links a file given by a path relative to the current directory',
    run: () => build_twice('twice.c', [], twice_dir, 'twice_relative'),
  },
]

type RunCase = {
  name: string
  args: string[]
  input?: string
  status: number
  stdout: string
  stderr?: string
}

const commands_dir = join(root_dir, 'tests/bin')

// `lerta run`, which builds the program in a temporary directory, runs it and removes the
// directory, so that it leaves no file, whether the program succeeds or not.
const run_cases: RunCase[] = [
  { name: 'runs the program', args: ['run', hello], status: 0, stdout: hello_output },
  { name: 'optimizes', args: ['run', hello, '-O'], status: 0, stdout: hello_output },
  {
    name: 'passes no arguments after a lone --',
    args: ['run', join(commands_dir, 'count args.lerta'), '--'],
    status: 0,
    stdout: '0\n',
  },
  {
    name: 'gives the exit code of a leak, which the unoptimized program reports',
    args: ['run', join(twice_dir, 'leak.lerta'), join(twice_dir, 'leak.c')],
    status: 1,
    stdout: '',
    stderr: 'leak: 1 object(s)\n',
  },
  {
    name: 'compares nils from C as equal, whatever value they hold',
    args: ['run', join(twice_dir, 'dirty_nil.lerta'), join(twice_dir, 'dirty_nil.c')],
    status: 0,
    stdout: 'true true true\nfalse false\n',
  },
  {
    name: 'passes the exit code',
    args: ['run', join(commands_dir, 'exit_with.lerta'), '--', '3'],
    status: 3,
    stdout: '',
  },
  {
    name: 'passes the arguments after --, options included',
    args: ['run', join(commands_dir, 'print_args.lerta'), '-O', '--', '-O', '--', 'a b', '-o'],
    status: 0,
    stdout: '[-O]\n[--]\n[a b]\n[-o]\n',
  },
  {
    name: 'passes stdin',
    args: ['run', join(commands_dir, 'echo_stdin.lerta')],
    input: 'piped\n',
    status: 0,
    stdout: 'piped\n',
  },
  {
    // The panic aborts, so SIGABRT (6) ends the program.
    name: 'gives 128 plus the number of the signal that ended the program',
    args: ['run', join(root_dir, 'tests/panic/stack_overflow.lerta')],
    status: 134,
    stdout: '',
    stderr: 'stack overflow\n',
  },
  {
    name: 'links the files after the source',
    args: ['run', twice_source, twice_c],
    status: 0,
    stdout: '42\n',
  },
  {
    name: 'runs nothing after a compile error',
    args: ['run', join(root_dir, 'tests/name/undefined.lerta')],
    status: 1,
    stdout: '',
    stderr: `${join(root_dir, 'tests/name/undefined.lerta')}:1:1: undefined name 'say'\n`,
  },
]

const run_checks_of_run = run_cases.map(({ name, args, input, status, stdout, stderr }) => ({
  name: `lerta run ${name}`,
  run: () => {
    const ran = build_in_new_dir(args, input)
    return [
      ...expect_status(status, ran.status),
      ...compare_text('stdout', stdout, ran.stdout),
      ...(stderr === undefined ? [] : compare_text('stderr', stderr, ran.stderr)),
      ...expect_left('files left', [], ran.left),
      ...expect_left('files left in the temporary directory', [], ran.left_in_temp),
    ]
  },
}))

await run_suite(cli_work_dir, () =>
  run_checks('CLI checks', [
    ...cli_cases.map((cli_case) => ({
      name: `lerta ${cli_case.args.map(shorten_path).join(' ')}`,
      run: () => run_cli_case(cli_case),
    })),
    ...std_checks,
    ...build_and_run_checks,
    ...output_checks,
    ...linked_file_checks,
    ...run_checks_of_run,
  ]),
)
