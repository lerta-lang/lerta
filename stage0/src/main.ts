import { build, ClangError, type BuildOptions } from './build.ts'
import { CompileError } from './errors.ts'
import { SourceFileError } from './loader.ts'

const usage = 'usage: lerta build <source> -o <output> [-O] [--emit-llvm <path>]'

const fail_usage = (): never => {
  console.error(usage)
  process.exit(2)
}

type Arguments = { source_path: string; output_path: string; options: BuildOptions }

const is_value = (arg: string | undefined): arg is string =>
  arg !== undefined && !arg.startsWith('-')

// Every option may be given at most once.
const parse_arguments = (args: string[]): Arguments => {
  const [command, ...rest] = args
  if (command !== 'build') fail_usage()
  let source_path: string | undefined
  let output_path: string | undefined
  const options: BuildOptions = { optimize: false }
  const take_value = (i: number, previous: string | undefined): string => {
    const value = rest[i]
    return previous === undefined && is_value(value) ? value : fail_usage()
  }
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]
    if (arg === '-O' && !options.optimize) options.optimize = true
    else if (arg === '-o') output_path = take_value(++i, output_path)
    else if (arg === '--emit-llvm') options.llvm_path = take_value(++i, options.llvm_path)
    else if (source_path === undefined && is_value(arg)) source_path = arg
    else fail_usage()
  }
  if (source_path === undefined || output_path === undefined) fail_usage()
  return { source_path: source_path!, output_path: output_path!, options }
}

const { source_path, output_path, options } = parse_arguments(process.argv.slice(2))
try {
  const { warnings, clang_messages } = await build(source_path, output_path, options)
  for (const warning of warnings) console.error(warning.format(source_path))
  process.stderr.write(clang_messages)
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
