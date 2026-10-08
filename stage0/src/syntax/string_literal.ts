// `"..."` literals: escapes and `#{expression}` interpolation, within one line.
import { CompileError } from '../errors.ts'

// The source of an interpolated expression is parsed later; column is where it starts.
export type TemplatePart =
  { kind: 'text'; text: string } | { kind: 'code'; source: string; column: number }

const simple_escapes = new Map([
  ['n', '\n'],
  ['t', '\t'],
  ['r', '\r'],
  ['0', '\0'],
  ['\\', '\\'],
  ['"', '"'],
  ['#', '#'],
])

const MAX_CODE_POINT = 0x10ffff

// Reads the literal whose opening quote is at `start`. Returns its parts and the index after it.
// `column_offset` places `chars` in its line, for an interpolation inside another literal.
export const scan_double_quoted = (
  chars: string[],
  start: number,
  line: number,
  column_offset = 0,
): { parts: TemplatePart[]; end: number } => {
  const parts: TemplatePart[] = []
  let text = ''
  let i = start + 1
  const error = (message: string, index: number) =>
    new CompileError(message, line, index + 1 + column_offset)
  for (;;) {
    const c = chars[i]
    if (c === undefined) throw error('unterminated string literal', start)
    if (c === '"') break
    if (c === '\\') {
      const { value, end } = read_escape(chars, i, error)
      text += value
      i = end
    } else if (c === '#' && chars[i + 1] === '{') {
      const close = find_interpolation_end(chars, i + 2, line, column_offset)
      if (close === undefined) throw error('unterminated interpolation', i)
      if (text !== '') parts.push({ kind: 'text', text })
      text = ''
      const source = chars.slice(i + 2, close).join('')
      parts.push({ kind: 'code', source, column: i + 3 + column_offset })
      i = close + 1
    } else {
      text += c
      i++
    }
  }
  if (text !== '' || parts.length === 0) parts.push({ kind: 'text', text })
  return { parts, end: i + 1 }
}

const read_escape = (
  chars: string[],
  start: number,
  error: (message: string, index: number) => CompileError,
): { value: string; end: number } => {
  const kind = chars[start + 1]
  const simple = kind === undefined ? undefined : simple_escapes.get(kind)
  if (simple !== undefined) return { value: simple, end: start + 2 }
  if (kind !== 'u' || chars[start + 2] !== '{') throw error('invalid escape sequence', start)
  const close = chars.indexOf('}', start + 3)
  const digits = close === -1 ? '' : chars.slice(start + 3, close).join('')
  const code_point = /^[0-9A-Fa-f]{1,6}$/.test(digits) ? parseInt(digits, 16) : -1
  const is_surrogate = code_point >= 0xd800 && code_point <= 0xdfff
  if (code_point < 0 || code_point > MAX_CODE_POINT || is_surrogate) {
    throw error('invalid unicode escape', start)
  }
  return { value: String.fromCodePoint(code_point), end: close + 1 }
}

// The index of the `}` that closes an interpolation, skipping nested braces and string literals.
const find_interpolation_end = (
  chars: string[],
  start: number,
  line: number,
  column_offset: number,
): number | undefined => {
  let depth = 0
  for (let i = start; i < chars.length; i++) {
    const c = chars[i]
    if (c === '"') {
      i = scan_double_quoted(chars, i, line, column_offset).end - 1
    } else if (c === "'") {
      const close = chars.indexOf(c, i + 1)
      if (close === -1) return undefined
      i = close
    } else if (c === '{') {
      depth++
    } else if (c === '}') {
      if (depth === 0) return i
      depth--
    }
  }
  return undefined
}
