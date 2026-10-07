// Run tests: each tests/<name>.lerta is built and run, and its stdout must
// equal tests/<name>.out.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build } from '../src/build.ts'

const tests_dir = join(import.meta.dirname, '../../tests')
const work_dir = mkdtempSync(join(tmpdir(), 'lerta-test-'))

const run_test = (name: string): boolean => {
  try {
    const executable = join(work_dir, name)
    build(join(tests_dir, `${name}.lerta`), executable)
    const actual = execFileSync(executable, { encoding: 'utf8' })
    const expected = readFileSync(join(tests_dir, `${name}.out`), 'utf8')
    return actual === expected
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
