import type { Call, For, Identifier, Program, Statement } from './ast.ts'
import { ExpressionParser } from './expression_parser.ts'
import type { Token } from './lexer.ts'
import { TokenStream } from './token_stream.ts'

export const parse = (tokens: Token[]): Program =>
  new Parser(new TokenStream(tokens)).parse_program()

// Statements: the program, blocks, `for` and calls without parentheses.
class Parser {
  private readonly tokens: TokenStream
  private readonly expressions: ExpressionParser

  constructor(tokens: TokenStream) {
    this.tokens = tokens
    this.expressions = new ExpressionParser(tokens)
  }

  parse_program(): Program {
    return this.parse_statements('eof')
  }

  // Statements, one per line, up to the token that ends the block.
  private parse_statements(end: 'eof' | 'dedent'): Statement[] {
    const statements: Statement[] = []
    while (this.tokens.peek().kind !== end && this.tokens.peek().kind !== 'eof') {
      statements.push(this.parse_statement())
      this.tokens.expect_line_end()
    }
    return statements
  }

  // A newline and an indented block of statements.
  private parse_block(): Statement[] {
    this.tokens.expect('newline', 'end of line')
    this.tokens.expect('indent', 'indented block')
    const statements = this.parse_statements('dedent')
    this.tokens.expect('dedent', 'end of block')
    return statements
  }

  private parse_statement(): Statement {
    if (this.tokens.peek().kind === 'for') return this.parse_for()
    const is_command_call =
      this.tokens.peek().kind === 'identifier' && this.starts_command_argument(this.tokens.peek(1))
    return is_command_call ? this.parse_command_call() : this.expressions.parse_expression()
  }

  // A call without parentheses, allowed only at the start of a statement.
  // `f -1` is `f(-1)`, but `f - 1` is a subtraction.
  private starts_command_argument(token: Token): boolean {
    if (!token.spaced) return false
    if (token.kind === '-') return !this.tokens.peek(2).spaced
    return ['identifier', 'integer', 'string', 'true', 'false', 'case', '('].includes(token.kind)
  }

  // `for <name> in <expression>` followed by an indented block.
  private parse_for(): For {
    const token = this.tokens.next()
    const variable = this.parse_identifier()
    this.tokens.expect('in', "'in'")
    const iterable = this.expressions.parse_expression()
    const body = this.parse_block()
    return { kind: 'for', variable, iterable, body, line: token.line, column: token.column }
  }

  private parse_identifier(): Identifier {
    const token = this.tokens.peek()
    if (token.kind !== 'identifier') throw this.tokens.error_at(token, 'name')
    this.tokens.next()
    return { kind: 'identifier', name: token.text, line: token.line, column: token.column }
  }

  // `f x, y`: the arguments run to the end of the line.
  private parse_command_call(): Call {
    const callee = this.expressions.parse_primary()
    const args = [this.expressions.parse_expression()]
    while (this.tokens.peek_continuation() === ',') {
      this.tokens.next()
      args.push(this.expressions.parse_expression())
    }
    return { kind: 'call', callee, args, line: callee.line, column: callee.column }
  }
}
