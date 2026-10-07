import {
  comparison_operators,
  type ArithmeticOperator,
  type Call,
  type Case,
  type CaseArm,
  type ComparisonOperator,
  type Expression,
  type Position,
  type Program,
} from './ast.ts'
import { CompileError } from './errors.ts'
import type { Token, TokenKind } from './lexer.ts'

export const parse = (tokens: Token[]): Program => new Parser(tokens).parse_program()

const INT_MIN = -(2n ** 63n)
const INT_MAX = 2n ** 63n - 1n

// Arithmetic operators by precedence, weakest first. Comparisons are weaker than all of them.
const arithmetic_precedence: ArithmeticOperator[][] = [
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
      this.expect_line_end()
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
    return ['identifier', 'integer', 'string', 'true', 'false', 'case', '('].includes(token.kind)
  }

  // `f x, y`: the arguments run to the end of the line.
  private parse_command_call(): Call {
    const callee = this.parse_primary()
    const args = [this.parse_expression()]
    while (this.peek_continuation() === ',') {
      this.next()
      args.push(this.parse_expression())
    }
    return { kind: 'call', callee, args, line: callee.line, column: callee.column }
  }

  private parse_expression(): Expression {
    return this.parse_comparison()
  }

  // `a < b < c` is an error: comparisons do not chain.
  private parse_comparison(): Expression {
    const left = this.parse_arithmetic(0)
    if (!this.at_comparison()) return left
    const operator = this.next().kind as ComparisonOperator
    const right = this.parse_arithmetic(0)
    if (this.at_comparison()) {
      const token = this.peek()
      throw new CompileError('comparison operators cannot be chained', token.line, token.column)
    }
    return { kind: 'binary', operator, left, right, line: left.line, column: left.column }
  }

  private at_comparison(): boolean {
    return (comparison_operators as readonly string[]).includes(this.peek_continuation())
  }

  private parse_arithmetic(level: number): Expression {
    if (level === arithmetic_precedence.length) return this.parse_unary()
    const operators = arithmetic_precedence[level]
    let left = this.parse_arithmetic(level + 1)
    while (operators.includes(this.peek_continuation() as ArithmeticOperator)) {
      const operator = this.next().kind as ArithmeticOperator
      const right = this.parse_arithmetic(level + 1)
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
    if (token.kind === 'true' || token.kind === 'false') {
      return { kind: 'boolean', value: token.kind === 'true', ...position }
    }
    if (token.kind === 'case') return this.parse_case(position)
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

  // `case` followed by an indented block of `when` arms and a final `else` arm.
  private parse_case(position: Position): Case {
    this.expect('newline', 'end of line')
    this.expect('indent', "indented 'when' arms")
    const arms: CaseArm[] = []
    do {
      this.expect('when', "'when'")
      const condition = this.parse_expression()
      arms.push({ condition, value: this.parse_arm_body('then') })
    } while (this.peek().kind === 'when')
    this.expect('else', "'when' or 'else'")
    const otherwise = this.parse_arm_body('else')
    this.expect('dedent', 'end of block')
    return { kind: 'case', arms, otherwise, ...position }
  }

  // The expression on the same line (`when c then x`, `else x`), or alone in an indented block.
  private parse_arm_body(arm: 'then' | 'else'): Expression {
    const is_inline = arm === 'then' ? this.accept('then') : this.peek().kind !== 'newline'
    if (is_inline) {
      const value = this.parse_expression()
      this.expect_line_end()
      return value
    }
    this.expect('newline', arm === 'then' ? "'then' or end of line" : 'end of line')
    this.expect('indent', 'indented block')
    const value = this.parse_expression()
    this.expect_line_end()
    this.expect('dedent', 'end of block')
    return value
  }

  // The kind of the next token if it continues the current expression. After an indented block
  // (such as a `case`) the line has ended, so `-1` on the next line is not a subtraction.
  private peek_continuation(): TokenKind {
    return this.ended_with_block() ? 'newline' : this.peek().kind
  }

  private ended_with_block(): boolean {
    return this.tokens[this.index - 1]?.kind === 'dedent'
  }

  // A line that ends with an indented block (such as a `case`) has already consumed its line end.
  private expect_line_end(): void {
    if (!this.ended_with_block()) this.expect('newline', 'end of line')
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
