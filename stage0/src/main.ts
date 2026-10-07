import { build } from './build.ts'
import { CompileError } from './errors.ts'

const usage = 'usage: lerta build <source> -o <output>'

const [command, source_path, output_flag, output_path] = process.argv.slice(2)
if (
  command !== 'build' ||
  source_path === undefined ||
  output_flag !== '-o' ||
  output_path === undefined
) {
  console.error(usage)
  process.exit(2)
}
try {
  const warnings = build(source_path, output_path)
  for (const warning of warnings) console.error(warning.format(source_path))
} catch (error) {
  if (!(error instanceof CompileError)) throw error
  for (const warning of error.warnings) console.error(warning.format(source_path))
  console.error(error.format(source_path))
  process.exit(1)
}
