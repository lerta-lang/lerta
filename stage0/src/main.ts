import { build } from './build.ts'

const usage = 'usage: lerta build <source> -o <output>'

const [command, source_path, output_flag, output_path] = process.argv.slice(2)
if (command !== 'build' || source_path === undefined || output_flag !== '-o' || output_path === undefined) {
  console.error(usage)
  process.exit(2)
}
build(source_path, output_path)
