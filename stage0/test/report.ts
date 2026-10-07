// Runs checks one by one and prints each result as it finishes.

// A check returns why it failed; an empty list means it passed, and undefined means it does not
// apply, so it is neither shown nor counted.
export type Check = { name: string; run: () => string[] | undefined }

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

const run_one = (check: Check): string[] | undefined => {
  try {
    return check.run()
  } catch (error) {
    const description = error instanceof Error ? (error.stack ?? error.message) : String(error)
    return ['threw:', ...description.split('\n').map((line) => `  ${line}`)]
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

// Returns the number of failed checks.
export const run_checks = (title: string, checks: Check[]): number => {
  // Results are printed as they come, so the width also counts checks that turn out not to apply.
  const name_width = Math.max(0, ...checks.map((check) => check.name.length))
  const started = performance.now()
  const failed: string[] = []
  let run_count = 0
  for (const check of checks) {
    const check_started = performance.now()
    const reasons = run_one(check)
    if (reasons === undefined) continue
    run_count++
    const duration = format_duration(performance.now() - check_started)
    const status = reasons.length === 0 ? 'ok  ' : 'FAIL'
    console.log(`${status}  ${check.name.padEnd(name_width)}  ${duration.padStart(6)}`)
    for (const reason of reasons) console.log(`      ${reason}`)
    if (reasons.length > 0) failed.push(check.name)
  }
  const total = format_duration(performance.now() - started)
  const passed = run_count - failed.length
  console.log(`${title}: ${passed} passed, ${failed.length} failed in ${total}`)
  for (const name of failed) console.log(`  FAIL ${name}`)
  console.log('')
  return failed.length
}
