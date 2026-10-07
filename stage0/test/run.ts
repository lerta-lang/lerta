// Run tests: each tests/<name>.lerta comes with either <name>.out, the expected
// stdout of the program, or <name>.err, the expected compile error.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build } from '../src/build.ts'
import { CompileError } from '../src/errors.ts'

const tests_dir = join(import.meta.dirname, '../../tests')
const work_dir = mkdtempSync(join(tmpdir(), 'lerta-test-'))

const expected_output = (name: string, extension: string): string | undefined => {
  const path = join(tests_dir, `${name}.${extension}`)
  return existsSync(path) ? readFileSync(path, 'utf8') : undefined
}

// Returns the program's stdout, or the compile error as the CLI prints it.
const compile_and_run = (name: string): { stdout: string } | { error: string } => {
  const source_file = `${name}.lerta`
  const executable = join(work_dir, name)
  try {
    build(join(tests_dir, source_file), executable)
  } catch (error) {
    if (!(error instanceof CompileError)) throw error
    return { error: `${error.format(source_file)}\n` }
  }
  return { stdout: execFileSync(executable, { encoding: 'utf8' }) }
}

const run_test = (name: string): boolean => {
  try {
    const expected_stdout = expected_output(name, 'out')
    const expected_error = expected_output(name, 'err')
    if ((expected_stdout === undefined) === (expected_error === undefined)) {
      console.error(`${name}: needs exactly one of ${name}.out and ${name}.err`)
      return false
    }
    const result = compile_and_run(name)
    if ('error' in result) return result.error === expected_error
    return result.stdout === expected_stdout
  } catch (error) {
    console.error(error)
    return false
  }
}

const names = readdirSync(tests_dir)
  .filter((file) => file.endsWith('.lerta'))
  .map((file) => file.slice(0, -'.lerta'.length))
let failed: string[]
try {
  failed = names.filter((name) => !run_test(name))
} finally {
  rmSync(work_dir, { recursive: true, force: true })
}

for (const name of failed) console.error(`FAIL ${name}`)
console.log(`${names.length - failed.length}/${names.length} passed`)
process.exit(failed.length === 0 ? 0 : 1)
