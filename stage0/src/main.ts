import { readFileSync } from 'node:fs'
import { build, ClangError, load_and_check, type BuildOptions } from './build.ts'
import { CompileError } from './errors.ts'
import { is_file, SourceFileError } from './loader.ts'
import { dump_checked } from './checked_dump.ts'
import { tokenize } from './syntax/lexer.ts'
import { dump_tokens } from './token_dump.ts'
import { dump_ast } from './ast_dump.ts'
import { parse } from './syntax/parser.ts'

const usage = [
  'usage: lerta build <source> -o <output> [-O] [--emit-llvm <path>]',
  '       lerta dump-tokens <source>',
  '       lerta dump-ast <source>',
  '       lerta dump-checked <source>',
].join('\n')

const fail_usage = (): never => {
  console.error(usage)
  process.exit(2)
}

type BuildArguments = { source_path: string; output_path: string; options: BuildOptions }

const is_value = (arg: string | undefined): arg is string =>
  arg !== undefined && !arg.startsWith('-')

// Every option may be given at most once.
const parse_build_arguments = (args: string[]): BuildArguments => {
  let source_path: string | undefined
  let output_path: string | undefined
  const options: BuildOptions = { optimize: false }
  const take_value = (i: number, previous: string | undefined): string => {
    const value = args[i]
    return previous === undefined && is_value(value) ? value : fail_usage()
  }
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '-O' && !options.optimize) options.optimize = true
    else if (arg === '-o') output_path = take_value(++i, output_path)
    else if (arg === '--emit-llvm') options.llvm_path = take_value(++i, options.llvm_path)
    else if (source_path === undefined && is_value(arg)) source_path = arg
    else fail_usage()
  }
  if (source_path === undefined || output_path === undefined) fail_usage()
  return { source_path: source_path!, output_path: output_path!, options }
}

const run_build = async (args: string[]): Promise<void> => {
  const { source_path, output_path, options } = parse_build_arguments(args)
  await report_failure(source_path, async () => {
    const { warnings, clang_messages } = await build(source_path, output_path, options)
    for (const warning of warnings) console.error(warning.format(source_path))
    process.stderr.write(clang_messages)
  })
}

// Prints what `dump` makes of one file, without reading the modules it imports.
const run_dump = async (args: string[], dump: (source: string) => string): Promise<void> => {
  const [source_path] = args
  if (args.length !== 1 || !is_value(source_path)) fail_usage()
  await report_failure(source_path, async () => {
    if (!is_file(source_path)) throw new SourceFileError(`'${source_path}' is not a file`)
    process.stdout.write(dump(readFileSync(source_path, 'utf8')))
  })
}

// Prints the checked syntax trees of the program, as `build` loads and checks it.
const run_dump_checked = async (args: string[]): Promise<void> => {
  const [source_path] = args
  if (args.length !== 1 || !is_value(source_path)) fail_usage()
  await report_failure(source_path, async () => {
    const { modules, checked, warnings } = load_and_check(source_path)
    for (const warning of warnings) console.error(warning.format(source_path))
    process.stdout.write(dump_checked(source_path, modules, checked))
  })
}

// Runs `f`, printing a failure that it throws and exiting with code 1.
const report_failure = async (source_path: string, f: () => Promise<void>): Promise<void> => {
  try {
    await f()
  } catch (error) {
    if (error instanceof ClangError) {
      process.stderr.write(error.messages)
      process.exit(1)
    }
    if (error instanceof SourceFileError) {
      console.error(error.message)
      process.exit(1)
    }
    if (!(error instanceof CompileError)) throw error
    for (const warning of error.warnings) console.error(warning.format(source_path))
    console.error(error.format(source_path))
    process.exit(1)
  }
}

const [command, ...rest] = process.argv.slice(2)
if (command === 'build') await run_build(rest)
else if (command === 'dump-tokens') await run_dump(rest, (source) => dump_tokens(tokenize(source)))
else if (command === 'dump-ast') await run_dump(rest, (source) => dump_ast(parse(tokenize(source))))
else if (command === 'dump-checked') await run_dump_checked(rest)
else fail_usage()
