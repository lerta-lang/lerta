// Tokens as text, one per line, so that the lexer of the compiler written in Lerta can be compared
// with this one.
import type { Token } from './syntax/lexer.ts'
import type { TemplatePart } from './syntax/string_literal.ts'

export const dump_tokens = (tokens: Token[]): string => tokens.map(dump_token).join('')

const dump_token = (token: Token): string => {
  const spacing = token.spaced ? 'spaced' : 'joined'
  const head = `${token.line}:${token.column} ${spacing} ${token.kind} ${quote(token.text)}\n`
  return head + (token.parts ?? []).map(dump_part).join('')
}

const dump_part = (part: TemplatePart): string =>
  part.kind === 'text'
    ? `  text ${quote(part.text)}\n`
    : `  code ${part.column} ${quote(part.source)}\n`

// The characters below U+0020, U+007F, `\` and `"` are written as `\xHH`, so that each token
// stays on its line.
const quote = (text: string): string => {
  const escaped = Array.from(text, (c) => {
    const code = c.codePointAt(0)!
    const is_plain = code >= 0x20 && code !== 0x7f && c !== '\\' && c !== '"'
    return is_plain ? c : `\\x${code.toString(16).toUpperCase().padStart(2, '0')}`
  })
  return `"${escaped.join('')}"`
}
