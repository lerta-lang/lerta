import type { BinaryOperator, Call, Expression, Position, Program } from './ast.ts'
import { CompileError } from './errors.ts'
import type { Token, TokenKind } from './lexer.ts'

export const parse = (tokens: Token[]): Program => new Parser(tokens).parse_program()

const INT_MIN = -(2n ** 63n)
const INT_MAX = 2n ** 63n - 1n

// Binary operators by precedence, weakest first.
const binary_precedence: BinaryOperator[][] = [
  ['+', '-'],
  ['*', '/', '%'],
]

const describe_token = (token: Token): string => {
  switch (token.kind) {
    case 'identifier':
      return `'${token.text}'`
    case 'integer':
      return 'integer literal'
    case 'string':
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

class Parser {
  private readonly tokens: Token[]
  private index = 0

  constructor(tokens: Token[]) {
    this.tokens = tokens
  }

  parse_program(): Program {
    const statements: Program = []
    while (this.peek().kind !== 'eof') {
      statements.push(this.parse_statement())
      this.expect('newline', 'end of line')
    }
    return statements
  }

  private parse_statement(): Expression {
    const is_command_call =
      this.peek().kind === 'identifier' && this.starts_command_argument(this.peek(1))
    return is_command_call ? this.parse_command_call() : this.parse_expression()
  }

  // A call without parentheses, allowed only at the start of a statement.
  // `f -1` is `f(-1)`, but `f - 1` is a subtraction.
  private starts_command_argument(token: Token): boolean {
    if (!token.spaced) return false
    if (token.kind === '-') return !this.peek(2).spaced
    return ['identifier', 'integer', 'string', '('].includes(token.kind)
  }

  // `f x, y`: the arguments run to the end of the line.
  private parse_command_call(): Call {
    const callee = this.parse_primary()
    const args = [this.parse_expression()]
    while (this.accept(',')) args.push(this.parse_expression())
    return { kind: 'call', callee, args, line: callee.line, column: callee.column }
  }

  private parse_expression(): Expression {
    return this.parse_binary(0)
  }

  private parse_binary(level: number): Expression {
    if (level === binary_precedence.length) return this.parse_unary()
    const operators = binary_precedence[level]
    let left = this.parse_binary(level + 1)
    while (operators.includes(this.peek().kind as BinaryOperator)) {
      const operator = this.next().kind as BinaryOperator
      const right = this.parse_binary(level + 1)
      left = { kind: 'binary', operator, left, right, line: left.line, column: left.column }
    }
    return left
  }

  private parse_unary(): Expression {
    const token = this.peek()
    if (token.kind !== '-') return this.parse_postfix(this.parse_primary())
    this.next()
    // `-1` with no space is a negative literal, so that the minimum Int can be written.
    const literal = this.peek()
    if (literal.kind === 'integer' && !literal.spaced) {
      this.next()
      const position = { line: token.line, column: token.column }
      const value = integer_value(-BigInt(literal.text), position)
      return this.parse_postfix({ kind: 'integer', value, ...position })
    }
    const operand = this.parse_unary()
    return { kind: 'unary', operator: '-', operand, line: token.line, column: token.column }
  }

  private parse_postfix(primary: Expression): Expression {
    let expression = primary
    while (this.peek().kind === '(' && !this.peek().spaced) {
      this.next()
      const args = this.parse_parenthesized_arguments()
      expression = {
        kind: 'call',
        callee: expression,
        args,
        line: expression.line,
        column: expression.column,
      }
    }
    return expression
  }

  // The arguments after an opening parenthesis, through the closing one.
  private parse_parenthesized_arguments(): Expression[] {
    const args: Expression[] = []
    if (this.accept(')')) return args
    args.push(this.parse_expression())
    while (this.accept(',')) args.push(this.parse_expression())
    this.expect(')', "')'")
    return args
  }

  private parse_primary(): Expression {
    const token = this.next()
    const position = { line: token.line, column: token.column }
    if (token.kind === 'identifier') return { kind: 'identifier', name: token.text, ...position }
    if (token.kind === 'string') return { kind: 'string', value: token.text, ...position }
    if (token.kind === 'integer')
      return { kind: 'integer', value: integer_value(BigInt(token.text), position), ...position }
    if (token.kind === '(') {
      const expression = this.parse_expression()
      this.expect(')', "')'")
      // Diagnostics about the group point at its opening parenthesis.
      return { ...expression, ...position }
    }
    throw this.error_at(token, 'expression')
  }

  private peek(offset = 0): Token {
    return this.tokens[Math.min(this.index + offset, this.tokens.length - 1)]
  }

  private next(): Token {
    const token = this.peek()
    if (token.kind !== 'eof') this.index++
    return token
  }

  private accept(kind: TokenKind): boolean {
    if (this.peek().kind !== kind) return false
    this.next()
    return true
  }

  private expect(kind: TokenKind, description: string): void {
    if (!this.accept(kind)) throw this.error_at(this.peek(), description)
  }

  private error_at(token: Token, expected: string): CompileError {
    return new CompileError(
      `expected ${expected}, found ${describe_token(token)}`,
      token.line,
      token.column,
    )
  }
}

const integer_value = (value: bigint, position: Position): bigint => {
  if (value < INT_MIN || value > INT_MAX) {
    throw new CompileError('integer literal does not fit in Int', position.line, position.column)
  }
  return value
}
