// CLI checks: each invocation of the compiler's command line (see lerta.ts) and its expected exit
// status, by the kind of check in cli/.
import { run_checks, run_suite } from './report.ts'
import { build_checks } from './cli/build.ts'
import { cache_checks } from './cli/cache.ts'
import { work_dir } from './cli/common.ts'
import { extern_checks } from './cli/extern.ts'
import { file_checks } from './cli/files.ts'
import { program_checks } from './cli/programs.ts'
import { std_checks } from './cli/std.ts'

await run_suite(work_dir, () =>
  run_checks('CLI checks', [
    ...file_checks,
    ...program_checks,
    ...std_checks,
    ...build_checks,
    ...cache_checks,
    ...extern_checks,
  ]),
)
