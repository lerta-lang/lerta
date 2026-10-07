import {
  comparison_operators,
  type ArithmeticOperator,
  type Case,
  type CaseArm,
  type ComparisonOperator,
  type Expression,
  type Position,
} from './ast.ts'
import { CompileError } from './errors.ts'
import { TokenStream } from './token_stream.ts'

const INT_MIN = -(2n ** 63n)
const INT_MAX = 2n ** 63n - 1n

// Arithmetic operators by precedence, weakest first. Comparisons are weaker than all of them.
const arithmetic_precedence: ArithmeticOperator[][] = [
  ['+', '-'],
  ['*', '/', '%'],
]

// Expressions, from the weakest operators down to primaries such as literals and `case`.
export class ExpressionParser {
  private readonly tokens: TokenStream

  constructor(tokens: TokenStream) {
    this.tokens = tokens
  }

  parse_expression(): Expression {
    return this.parse_comparison()
  }

  // `a < b < c` is an error: comparisons do not chain.
  private parse_comparison(): Expression {
    const left = this.parse_range()
    if (!this.at_comparison()) return left
    const operator = this.tokens.next().kind as ComparisonOperator
    const right = this.parse_range()
    if (this.at_comparison()) {
      const token = this.tokens.peek()
      throw new CompileError('comparison operators cannot be chained', token.line, token.column)
    }
    return { kind: 'binary', operator, left, right, line: left.line, column: left.column }
  }

  // Ranges do not chain either: `a...b...c` is an error.
  private parse_range(): Expression {
    const start = this.parse_arithmetic(0)
    if (this.tokens.peek_continuation() !== '...') return start
    this.tokens.next()
    const end = this.parse_arithmetic(0)
    if (this.tokens.peek_continuation() === '...') {
      const token = this.tokens.peek()
      throw new CompileError('ranges cannot be chained', token.line, token.column)
    }
    return { kind: 'range', start, end, line: start.line, column: start.column }
  }

  private at_comparison(): boolean {
    return (comparison_operators as readonly string[]).includes(this.tokens.peek_continuation())
  }

  private parse_arithmetic(level: number): Expression {
    if (level === arithmetic_precedence.length) return this.parse_unary()
    const operators = arithmetic_precedence[level]
    let left = this.parse_arithmetic(level + 1)
    while (operators.includes(this.tokens.peek_continuation() as ArithmeticOperator)) {
      const operator = this.tokens.next().kind as ArithmeticOperator
      const right = this.parse_arithmetic(level + 1)
      left = { kind: 'binary', operator, left, right, line: left.line, column: left.column }
    }
    return left
  }

  private parse_unary(): Expression {
    const token = this.tokens.peek()
    if (token.kind !== '-') return this.parse_postfix(this.parse_primary())
    this.tokens.next()
    // `-1` with no space is a negative literal, so that the minimum Int can be written.
    const literal = this.tokens.peek()
    if (literal.kind === 'integer' && !literal.spaced) {
      this.tokens.next()
      const position = { line: token.line, column: token.column }
      const value = integer_value(-BigInt(literal.text), position)
      return this.parse_postfix({ kind: 'integer', value, ...position })
    }
    const operand = this.parse_unary()
    return { kind: 'unary', operator: '-', operand, line: token.line, column: token.column }
  }

  private parse_postfix(primary: Expression): Expression {
    let expression = primary
    while (this.tokens.peek().kind === '(' && !this.tokens.peek().spaced) {
      this.tokens.next()
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
    if (this.tokens.accept(')')) return args
    args.push(this.parse_expression())
    while (this.tokens.accept(',')) args.push(this.parse_expression())
    this.tokens.expect(')', "')'")
    return args
  }

  parse_primary(): Expression {
    const token = this.tokens.next()
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
      this.tokens.expect(')', "')'")
      // Diagnostics about the group point at its opening parenthesis.
      return { ...expression, ...position }
    }
    throw this.tokens.error_at(token, 'expression')
  }

  // `case` followed by an indented block of `when` arms and a final `else` arm.
  private parse_case(position: Position): Case {
    this.tokens.expect('newline', 'end of line')
    this.tokens.expect('indent', "indented 'when' arms")
    const arms: CaseArm[] = []
    do {
      this.tokens.expect('when', "'when'")
      const condition = this.parse_expression()
      arms.push({ condition, value: this.parse_arm_body('then') })
    } while (this.tokens.peek().kind === 'when')
    this.tokens.expect('else', "'when' or 'else'")
    const otherwise = this.parse_arm_body('else')
    this.tokens.expect('dedent', 'end of block')
    return { kind: 'case', arms, otherwise, ...position }
  }

  // The expression on the same line (`when c then x`, `else x`), or alone in an indented block.
  private parse_arm_body(arm: 'then' | 'else'): Expression {
    const is_inline =
      arm === 'then' ? this.tokens.accept('then') : this.tokens.peek().kind !== 'newline'
    if (is_inline) {
      const value = this.parse_expression()
      this.tokens.expect_line_end()
      return value
    }
    this.tokens.expect('newline', arm === 'then' ? "'then' or end of line" : 'end of line')
    this.tokens.expect('indent', 'indented block')
    const value = this.parse_expression()
    this.tokens.expect_line_end()
    this.tokens.expect('dedent', 'end of block')
    return value
  }
}

const integer_value = (value: bigint, position: Position): bigint => {
  if (value < INT_MIN || value > INT_MAX) {
    throw new CompileError('integer literal does not fit in Int', position.line, position.column)
  }
  return value
}
