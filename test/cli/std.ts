// A program does not report the warnings of the standard modules, so each is built on its own,
// where they are its warnings, and must have none.
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { compiler, root_dir } from '../lerta.ts'
import { compare_text, expect_success } from '../expect.ts'
import type { Check } from '../report.ts'
import { run_command, work_dir } from './common.ts'

const std_dir = join(root_dir, 'std')
// The files of std/'s directories, as std/internal/, are no standard modules: those that import
// them build with their warnings.
const std_modules = readdirSync(std_dir)
  .filter((file) => file.endsWith('.lerta'))
  .map((file) => `std:${file.replace(/\.lerta$/, '')}`)

export const std_checks: Check[] = std_modules.map((module) => ({
  name: `${module} builds without warnings`,
  run: async () => {
    const args = ['build', module, '-o', join(work_dir, module.replace(':', '_')), '-Werror']
    const built = await run_command(compiler, args)
    if (built.status !== 0) return expect_success('build', built)
    return compare_text('stderr', '', built.stderr)
  },
}))
