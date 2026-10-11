// Runs checks, several at once if asked, and prints each result in order as soon as it and those
// before it have finished; and runs a script's checks to its exit (see run_suite).
import { rmSync } from 'node:fs'

// A check returns why it failed; an empty list means it passed, and undefined means it does not
// apply, so it is neither shown nor counted.
export type Check = {
  name: string
  // Something to wait for before the check starts, not counted in its time.
  wait?: () => Promise<unknown> | undefined
  run: () => string[] | undefined | Promise<string[] | undefined>
}

// Names are padded to align the times, but only up to this width, so that one long name does not
// push every line past the width of a terminal.
const MAX_NAME_WIDTH = 72

type Result = { reasons: string[] | undefined; duration: number }

const run_one = async (check: Check): Promise<Result> => {
  await check.wait?.()
  const started = performance.now()
  try {
    const reasons = await check.run()
    return { reasons, duration: performance.now() - started }
  } catch (error) {
    const description = error instanceof Error ? (error.stack ?? error.message) : String(error)
    const reasons = ['threw:', ...description.split('\n').map((line) => `  ${line}`)]
    return { reasons, duration: performance.now() - started }
  }
}

// `run` returns how many checks failed.
export const run_suite = async (work_dir: string, run: () => Promise<number>): Promise<never> => {
  let failed_count: number
  try {
    failed_count = await run()
  } finally {
    rmSync(work_dir, { recursive: true, force: true })
  }
  process.exit(failed_count === 0 ? 0 : 1)
}

// The unit is chosen after rounding, so that 999.6ms shows as 1.0s rather than 1000ms.
const format_duration = (milliseconds: number): string => {
  const microseconds = Math.round(milliseconds * 1000)
  if (microseconds < 1000) return `${microseconds}µs`
  const rounded_milliseconds = Math.round(milliseconds)
  if (rounded_milliseconds < 1000) return `${rounded_milliseconds}ms`
  return `${(milliseconds / 1000).toFixed(1)}s`
}

// Returns the number of failed checks. At most `concurrency` checks run at once.
export const run_checks = async (
  title: string,
  checks: Check[],
  concurrency = 1,
): Promise<number> => {
  // Results are printed as they come, so the width also counts checks that turn out not to apply.
  const longest = Math.max(0, ...checks.map((check) => check.name.length))
  const name_width = Math.min(longest, MAX_NAME_WIDTH)
  const started = performance.now()
  const failed: string[] = []
  let run_count = 0
  const print = (check: Check, { reasons, duration }: Result) => {
    if (reasons === undefined) return
    run_count++
    const status = reasons.length === 0 ? 'ok  ' : 'FAIL'
    const shown_duration = format_duration(duration).padStart(6)
    console.log(`${status}  ${check.name.padEnd(name_width)}  ${shown_duration}`)
    for (const reason of reasons) console.log(`      ${reason}`)
    if (reasons.length > 0) failed.push(check.name)
  }
  const results: (Result | undefined)[] = checks.map(() => undefined)
  let next_to_print = 0
  let next_to_start = 0
  const worker = async () => {
    while (next_to_start < checks.length) {
      const index = next_to_start++
      results[index] = await run_one(checks[index])
      while (results[next_to_print] !== undefined) {
        print(checks[next_to_print], results[next_to_print]!)
        next_to_print++
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker))
  const total = format_duration(performance.now() - started)
  const passed = run_count - failed.length
  console.log(`${title}: ${passed} passed, ${failed.length} failed in ${total}`)
  for (const name of failed) console.log(`  FAIL ${name}`)
  console.log('')
  return failed.length
}
