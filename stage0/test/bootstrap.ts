// The bootstrap check: stage0 builds the compiler written in Lerta (stage1), stage1 builds it again
// (stage2), and stage2 builds it once more (stage3). stage2 and stage3 must write the same LLVM IR
// for it. The executables are not compared, since the linker writes a different identifier into
// each one. With `--target` (see target.ts), stage2 and stage3 are built for that target, so that
// stage3's IR comes from the compiler running there.
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build, OUTPUT_LIMIT } from '../src/build.ts'
import { compare_text, run_checks } from './report.ts'
import { target_args } from './target.ts'

const root_dir = join(import.meta.dirname, '../..')
const work_dir = mkdtempSync(join(tmpdir(), 'lerta-bootstrap-'))
const main_source = join(root_dir, 'compiler/main.lerta')
const stage = (n: number): string => join(work_dir, `stage${n}`)
const target = target_args('bootstrap.ts')

// Builds the next stage with the compiler of stage `n`, writing its IR beside it. Returns why it
// failed, if it did.
const build_with_stage = (n: number): string[] => {
  const args = ['build', main_source, '-o', stage(n + 1), '--emit-llvm', `${stage(n + 1)}.ll`]
  const { status, signal, error, stderr } = spawnSync(
    stage(n),
    [...args, ...target, '--root', root_dir],
    {
      encoding: 'utf8',
      maxBuffer: OUTPUT_LIMIT,
    },
  )
  if (status === 0) return []
  const ending = error?.message ?? (signal === null ? `exit status ${status}` : `signal ${signal}`)
  // stderr is undefined when the stage could not be started.
  const messages = (stderr ?? '').trimEnd()
  return [`stage${n} failed to build stage${n + 1}: ${ending}`, ...messages.split('\n')]
}

// Each stage needs the one before it, so the first failure ends the check.
const bootstrap = async (): Promise<string[]> => {
  await build(main_source, stage(1), { optimize: false })
  for (const n of [1, 2]) {
    const failure = build_with_stage(n)
    if (failure.length > 0) return failure
  }
  const ir = (n: number) => readFileSync(`${stage(n)}.ll`, 'utf8')
  return compare_text('IR', ir(2), ir(3))
}

let failed_count: number
try {
  failed_count = await run_checks('bootstrap checks', [
    { name: 'stage2 and stage3, built from stage0, write the same IR', run: bootstrap },
  ])
} finally {
  rmSync(work_dir, { recursive: true, force: true })
}
process.exit(failed_count === 0 ? 0 : 1)
