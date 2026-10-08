// Where the tests find the repository and the compiler they check, bin/lerta, which `make` builds.
import { existsSync } from 'node:fs'
import { join } from 'node:path'

export const root_dir = join(import.meta.dirname, '..')

export const compiler = join(root_dir, 'bin/lerta')
if (!existsSync(compiler)) {
  console.error(`${compiler} is missing: run make, or make test, which builds it first`)
  process.exit(2)
}

// The most output kept from a program that a test runs; the limit only stops runaway output.
export const OUTPUT_LIMIT = 64 * 1024 * 1024
