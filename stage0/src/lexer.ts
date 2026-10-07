// Covers only the tokens the parser uses so far; any other character is an
// unexpected character until the feature that needs it is implemented.
import { CompileError } from './errors.ts'
import { scan_double_quoted, type TemplatePart } from './string_literal.ts'

export type TokenKind =
  | 'identifier'
  | Keyword
  | 'integer'
  | 'string'
  | 'interpolated'
  | Punctuation
  | 'newline'
  | 'indent'
  | 'dedent'
  | 'eof'

const keywords = [
  ...['true', 'false', 'nil', 'and', 'or', 'not'],
  ...['const', 'var', 'if', 'else', 'while', 'for', 'in', 'break', 'continue', 'return'],
  ...['case', 'when', 'then', 'class', 'struct', 'throw', 'import'],
] as const
type Keyword = (typeof keywords)[number]

// Longer punctuations come first so that `<=` is not read as `<` and `=`.
const punctuations = [
  '...',
  ...['==', '!=', '<=', '>=', '+=', '-=', '*=', '/=', '%=', '->'],
  ...[
    '(',
    ')',
    '[',
    ']',
    '{',
    '}',
    ',',
    '.',
    ':',
    '+',
    '-',
    '*',
    '/',
    '%',
    '<',
    '>',
    '=',
    '?',
    '!',
    '@',
    '|',
  ],
] as const
type Punctuation = (typeof punctuations)[number]

export type Token = {
  kind: TokenKind
  // The identifier name, the integer's digits without separators, the string literal's contents
  // or the punctuation; empty for layout tokens.
  text: string
  // Whether whitespace or the start of the line precedes it: `f (x)` and `f(x)` parse differently.
  spaced: boolean
  line: number
  // Counted in code points, starting at 1.
  column: number
  // The parts of an `interpolated` string.
  parts?: TemplatePart[]
}

// A line split into code points, so that an index plus one is the column.
type Chars = string[]

const is_identifier_start = (c: string): boolean => /[A-Za-z_]/.test(c)
const is_identifier_part = (c: string): boolean => /[A-Za-z0-9_]/.test(c)
const is_digit = (c: string): boolean => /[0-9]/.test(c)
const is_keyword = (word: string): word is Keyword => (keywords as readonly string[]).includes(word)
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

// The tokens of an interpolated expression, placed where it is in the source line.
export const tokenize_fragment = (source: string, line: number, column: number): Token[] => {
  const tokens = tokenize_line(Array.from(source), 0, line, column - 1)
  const end = column + Array.from(source).length
  tokens.push({ kind: 'newline', text: '', spaced: true, line, column: end })
  tokens.push({ kind: 'eof', text: '', spaced: true, line, column: end })
  return tokens
}

// `column_offset` places `chars` in its line, for the code of an interpolation.
const tokenize_line = (chars: Chars, start: number, line: number, column_offset = 0): Token[] => {
  const tokens: Token[] = []
  let i = start
  const push = (
    kind: TokenKind,
    text: string,
    token_start: number,
    end: number,
    parts?: TemplatePart[],
  ) => {
    const spaced = token_start === 0 || chars[token_start - 1] === ' '
    tokens.push({ kind, text, spaced, line, column: token_start + 1 + column_offset, parts })
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
      const word = chars.slice(i, end).join('')
      push(is_keyword(word) ? word : 'identifier', word, i, end)
    } else if (c === "'") {
      const close = chars.indexOf("'", i + 1)
      const column = i + 1 + column_offset
      if (close === -1) throw new CompileError('unterminated string literal', line, column)
      push('string', chars.slice(i + 1, close).join(''), i, close + 1)
    } else if (c === '"') {
      const { parts, end } = scan_double_quoted(chars, i, line, column_offset)
      const [first] = parts
      if (parts.length === 1 && first.kind === 'text') push('string', first.text, i, end)
      else push('interpolated', '', i, end, parts)
    } else if (is_digit(c)) {
      const end = scan_while(chars, i, is_identifier_part)
      const digits = integer_digits(chars.slice(i, end).join(''), line, i + 1 + column_offset)
      push('integer', digits, i, end)
    } else {
      const punctuation = punctuation_at(chars, i)
      if (punctuation === undefined) {
        const column = i + 1 + column_offset
        throw new CompileError(`unexpected character ${describe_char(c)}`, line, column)
      }
      push(punctuation, punctuation, i, i + punctuation.length)
    }
  }
  return tokens
}

// `1_000` is 1000. A separator goes only between digits, and a leading zero is
// rejected so that `010` is not mistaken for octal.
const integer_digits = (text: string, line: number, column: number): string => {
  const is_valid = /^(0|[1-9](_?[0-9])*)$/.test(text)
  if (!is_valid) throw new CompileError(`invalid integer literal '${text}'`, line, column)
  return text.replaceAll('_', '')
}

const punctuation_at = (chars: Chars, i: number): Punctuation | undefined =>
  punctuations.find((p) => chars.slice(i, i + p.length).join('') === p)

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
