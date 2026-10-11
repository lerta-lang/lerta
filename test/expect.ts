// What checks expect of the programs they run, as the reasons for a failure (see Check in report.ts).

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

// Lines with their line ends, as programs print them.
export const lines = (texts: string[]): string => texts.map((text) => `${text}\n`).join('')

export const expect_status = (expected: number, actual: number | null): string[] =>
  expected === actual ? [] : [`expected exit status ${expected}, got ${actual}`]

// For a command that should succeed, what it printed to stderr when it did not.
export const expect_success = (
  what: string,
  { status, stderr, error }: { status: number | null; stderr: string; error?: Error },
): string[] => {
  if (status === 0) return []
  const cause = error?.message ?? `exit status ${status}`
  return [`${what} failed (${cause}), stderr:\n${stderr}`]
}
