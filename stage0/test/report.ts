// Runs checks, several at once if asked, and prints each result in order as soon as it and those
// before it have finished.

// A check returns why it failed; an empty list means it passed, and undefined means it does not
// apply, so it is neither shown nor counted.
export type Check = {
  name: string
  // Something to wait for before the check starts, not counted in its time.
  wait?: () => Promise<unknown> | undefined
  run: () => string[] | undefined | Promise<string[] | undefined>
}

const MAX_SHOWN_LINES = 10
const CONTEXT_LINES = 2

// Lines with their line ends, so that a missing final newline stays visible.
const split_lines = (text: string): string[] => text.match(/[^\n]*\n|[^\n]+$/g) ?? []

// Lines from `start`, numbered and quoted so that spaces, `\r` and line ends are visible.
const show_lines = (lines: string[], start: number): string[] => {
  if (lines.length === 0) return ['(empty)']
  const shown = lines
    .slice(start, start + MAX_SHOWN_LINES)
    .map((line, i) => `${String(start + i + 1).padStart(4)} ${JSON.stringify(line)}`)
  const hidden = lines.length - start - shown.length
  return hidden > 0 ? [...shown, `     (${hidden} more line(s))`] : shown
}

// The reasons for a mismatch between expected and actual text, shown from just before the first
// line that differs.
export const compare_text = (what: string, expected: string, actual: string): string[] => {
  if (expected === actual) return []
  const expected_lines = split_lines(expected)
  const actual_lines = split_lines(actual)
  let first_difference = 0
  while (expected_lines[first_difference] === actual_lines[first_difference]) first_difference++
  const start = Math.max(0, first_difference - CONTEXT_LINES)
  return [
    `${what} differs from line ${first_difference + 1}`,
    '  expected:',
    ...show_lines(expected_lines, start).map((line) => `  ${line}`),
    '  actual:',
    ...show_lines(actual_lines, start).map((line) => `  ${line}`),
  ]
}

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
  const name_width = Math.max(0, ...checks.map((check) => check.name.length))
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
