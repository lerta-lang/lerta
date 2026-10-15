// A program does not report the warnings of the standard modules, so each is built on its own,
// where they are its warnings, and must have none.
import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { compiler, root_dir } from '../lerta.ts'
import { compare_text, expect_success } from '../expect.ts'
import type { Check } from '../report.ts'
import { work_dir } from './common.ts'

const std_dir = join(root_dir, 'std')
const std_modules = readdirSync(std_dir).map((file) => `std:${file.replace(/\.lerta$/, '')}`)

export const std_checks: Check[] = std_modules.map((module) => ({
  name: `${module} builds without warnings`,
  run: () => {
    const args = ['build', module, '-o', join(work_dir, module.replace(':', '_')), '-Werror']
    const built = spawnSync(compiler, args, { encoding: 'utf8' })
    if (built.status !== 0) return expect_success('build', built)
    return compare_text('stderr', '', built.stderr)
  },
}))
