import { CompileError } from './errors.ts'
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

  peek(offset = 0): Token {
    return this.tokens[Math.min(this.index + offset, this.tokens.length - 1)]
  }

  next(): Token {
    const token = this.peek()
    if (token.kind !== 'eof') this.index++
    return token
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
