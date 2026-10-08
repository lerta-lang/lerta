import { CompileError } from '../errors.ts'
import type { Token, TokenKind } from './lexer.ts'

const describe_token = (token: Token): string => {
  switch (token.kind) {
    case 'identifier':
      return `'${token.text}'`
    case 'integer':
      return 'integer literal'
    case 'string':
    case 'interpolated':
      return 'string literal'
    case 'newline':
      return 'end of line'
    case 'line_break':
      return 'end of line inside brackets'
    case 'indent':
      return 'indentation'
    case 'dedent':
      return 'end of block'
    case 'eof':
      return 'end of file'
    default:
      return `'${token.text}'`
  }
}

// A cursor over the tokens, shared by the parsers of expressions and statements.
export class TokenStream {
  private readonly tokens: Token[]
  private index = 0
  // How line breaks are read inside the brackets being parsed: as separators of a list's items,
  // or skipped, as in a grouping. Outside brackets there are none.
  private readonly line_breaks: ('separate' | 'skip')[] = []

  constructor(tokens: Token[]) {
    this.tokens = tokens
  }

  // The kind of the next token if it continues the current expression. After an indented block
  // (such as a `case`) the line has ended, so `-1` on the next line is not a subtraction.
  peek_continuation(): TokenKind {
    return this.ended_with_block() ? 'newline' : this.peek().kind
  }

  private ended_with_block(): boolean {
    return this.tokens[this.index - 1]?.kind === 'dedent'
  }

  // A line that ends with an indented block (such as a `case`) has already consumed its line end.
  expect_line_end(): void {
    if (!this.ended_with_block()) this.expect('newline', 'end of line')
  }

  // Runs `parse` on the contents of brackets, whose line breaks it reads as `mode` says.
  inside<T>(mode: 'separate' | 'skip', parse: () => T): T {
    this.line_breaks.push(mode)
    try {
      return parse()
    } finally {
      this.line_breaks.pop()
    }
  }

  peek(offset = 0): Token {
    return this.tokens[this.index_at(offset)]
  }

  next(): Token {
    const index = this.index_at(0)
    const token = this.tokens[index]
    if (token.kind !== 'eof') this.index = index + 1
    return token
  }

  // The index of the token `offset` tokens ahead, past the line breaks that are skipped.
  private index_at(offset: number): number {
    const skips = this.line_breaks.at(-1) !== 'separate'
    let index = this.index
    for (let remaining = offset; ; index++) {
      if (index >= this.tokens.length - 1) return this.tokens.length - 1
      if (skips && this.tokens[index].kind === 'line_break') continue
      if (remaining === 0) return index
      remaining--
    }
  }

  accept(kind: TokenKind): boolean {
    if (this.peek().kind !== kind) return false
    this.next()
    return true
  }

  expect(kind: TokenKind, description: string): void {
    if (!this.accept(kind)) throw this.error_at(this.peek(), description)
  }

  error_at(token: Token, expected: string): CompileError {
    return new CompileError(
      `expected ${expected}, found ${describe_token(token)}`,
      token.line,
      token.column,
    )
  }
}
