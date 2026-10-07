// Covers only the tokens the parser uses so far; any other character is an
// unexpected character until the feature that needs it is implemented.
import { CompileError } from './errors.ts'

export type TokenKind =
  'identifier' | 'string' | '(' | ')' | ',' | 'newline' | 'indent' | 'dedent' | 'eof'

export type Token = {
  kind: TokenKind
  // The identifier name, the string literal's contents or the punctuation; empty for layout tokens.
  text: string
  // Whether whitespace or the start of the line precedes it: `f (x)` and `f(x)` parse differently.
  spaced: boolean
  line: number
  // Counted in code points, starting at 1.
  column: number
}

// A line split into code points, so that an index plus one is the column.
type Chars = string[]

const is_identifier_start = (c: string): boolean => /[A-Za-z_]/.test(c)
const is_identifier_part = (c: string): boolean => /[A-Za-z0-9_]/.test(c)
const punctuations = new Set(['(', ')', ','])
const is_printable_ascii = (c: string): boolean => /[ -~]/.test(c)

export const tokenize = (source: string): Token[] => {
  const tokens: Token[] = []
  const indent_stack = [0]
  const lines = source.split(/\r?\n/)

  lines.forEach((line_text, index) => {
    const line = index + 1
    const chars = Array.from(line_text)
    const indent = scan_while(chars, 0, (c) => c === ' ')
    const is_blank = indent === chars.length || chars[indent] === '#'
    if (is_blank) return
    if (chars[indent] === '\t') {
      throw new CompileError('tabs are not allowed in indentation', line, indent + 1)
    }
    emit_indentation(tokens, indent_stack, indent, line)
    tokens.push(...tokenize_line(chars, indent, line))
    tokens.push({ kind: 'newline', text: '', spaced: true, line, column: chars.length + 1 })
  })

  const eof_line = lines.length
  while (indent_stack.length > 1) {
    indent_stack.pop()
    tokens.push({ kind: 'dedent', text: '', spaced: true, line: eof_line, column: 1 })
  }
  tokens.push({ kind: 'eof', text: '', spaced: true, line: eof_line, column: 1 })
  return tokens
}

const emit_indentation = (
  tokens: Token[],
  indent_stack: number[],
  indent: number,
  line: number,
) => {
  const column = indent + 1
  if (indent > indent_stack.at(-1)!) {
    indent_stack.push(indent)
    tokens.push({ kind: 'indent', text: '', spaced: true, line, column })
    return
  }
  while (indent < indent_stack.at(-1)!) {
    indent_stack.pop()
    tokens.push({ kind: 'dedent', text: '', spaced: true, line, column })
  }
  if (indent !== indent_stack.at(-1)) {
    throw new CompileError('indentation does not match any outer block', line, column)
  }
}

const tokenize_line = (chars: Chars, start: number, line: number): Token[] => {
  const tokens: Token[] = []
  let i = start
  const push = (kind: TokenKind, text: string, token_start: number, end: number) => {
    const spaced = token_start === 0 || chars[token_start - 1] === ' '
    tokens.push({ kind, text, spaced, line, column: token_start + 1 })
    i = end
  }
  while (i < chars.length) {
    const c = chars[i]
    if (c === ' ') {
      i++
    } else if (c === '#') {
      break
    } else if (is_identifier_start(c)) {
      const end = scan_while(chars, i, is_identifier_part)
      push('identifier', chars.slice(i, end).join(''), i, end)
    } else if (c === "'") {
      const close = chars.indexOf("'", i + 1)
      if (close === -1) throw new CompileError('unterminated string literal', line, i + 1)
      push('string', chars.slice(i + 1, close).join(''), i, close + 1)
    } else if (punctuations.has(c)) {
      push(c as TokenKind, c, i, i + 1)
    } else {
      throw new CompileError(`unexpected character ${describe_char(c)}`, line, i + 1)
    }
  }
  return tokens
}

const scan_while = (chars: Chars, start: number, predicate: (c: string) => boolean): number => {
  let end = start
  while (end < chars.length && predicate(chars[end])) end++
  return end
}

// Control characters such as '\r' would garble the error line if printed raw.
const describe_char = (c: string): string => {
  if (is_printable_ascii(c)) return `'${c}'`
  const code_point = c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')
  return `U+${code_point}`
}
