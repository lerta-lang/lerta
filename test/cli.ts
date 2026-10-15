// CLI checks: each invocation of the compiler's command line (see lerta.ts) and its expected exit
// status, by the kind of check in cli/.
import { availableParallelism } from 'node:os'
import { build_runtimes } from './lerta.ts'
import { run_checks, run_suite } from './report.ts'
import { build_checks } from './cli/build.ts'
import { cache_checks } from './cli/cache.ts'
import { runtime_flags, work_dir } from './cli/common.ts'
import { extern_checks } from './cli/extern.ts'
import { file_checks } from './cli/files.ts'
import { program_checks } from './cli/programs.ts'
import { std_checks } from './cli/std.ts'

await run_suite(work_dir, async () => {
  // A runtime that does not build fails the checks that build with it, which report why.
  await build_runtimes(work_dir, runtime_flags).catch(() => {})
  // The cache checks compile the runtime into caches of their own, each with as many clang
  // processes as there are CPUs, several at once; they still end sooner than one after another.
  return run_checks(
    'CLI checks',
    [
      ...file_checks,
      ...program_checks,
      ...std_checks,
      ...build_checks,
      ...cache_checks,
      ...extern_checks,
    ],
    availableParallelism(),
  )
})
