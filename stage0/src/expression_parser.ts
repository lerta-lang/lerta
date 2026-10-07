import {
  comparison_operators,
  type ArithmeticOperator,
  type Case,
  type CaseArm,
  type ComparisonOperator,
  type Expression,
  type FunctionLiteral,
  type Identifier,
  type Parameter,
  type Position,
  type Statement,
  type TypeName,
} from './ast.ts'
import { CompileError } from './errors.ts'
import { tokenize_fragment } from './lexer.ts'
import { TokenStream } from './token_stream.ts'

const INT_MIN = -(2n ** 63n)
const INT_MAX = 2n ** 63n - 1n

// Arithmetic operators by precedence, weakest first. Comparisons are weaker than all of them.
const arithmetic_precedence: ArithmeticOperator[][] = [
  ['+', '-'],
  ['*', '/', '%'],
]

// Function bodies are statements, which the statement parser reads.
export type BodyParser = {
  parse_block(): Statement[]
  parse_simple_statement(): Statement
}

// Expressions, from the weakest operators down to primaries such as literals and `case`.
export class ExpressionParser {
  private readonly tokens: TokenStream

  private readonly bodies: BodyParser

  constructor(tokens: TokenStream, bodies: BodyParser) {
    this.tokens = tokens
    this.bodies = bodies
  }

  parse_expression(): Expression {
    return this.parse_coalesce()
  }

  // `a ? b ? c` is `a ? (b ? c)`.
  private parse_coalesce(): Expression {
    const value = this.parse_or()
    if (this.tokens.peek_continuation() !== '?') return value
    this.tokens.next()
    const fallback = this.parse_coalesce()
    return { kind: 'coalesce', value, fallback, line: value.line, column: value.column }
  }

  private parse_or(): Expression {
    let left = this.parse_and()
    while (this.tokens.peek_continuation() === 'or') {
      this.tokens.next()
      const right = this.parse_and()
      left = { kind: 'binary', operator: 'or', left, right, line: left.line, column: left.column }
    }
    return left
  }

  private parse_and(): Expression {
    let left = this.parse_not()
    while (this.tokens.peek_continuation() === 'and') {
      this.tokens.next()
      const right = this.parse_not()
      left = { kind: 'binary', operator: 'and', left, right, line: left.line, column: left.column }
    }
    return left
  }

  private parse_not(): Expression {
    const token = this.tokens.peek()
    if (token.kind !== 'not') return this.parse_comparison()
    this.tokens.next()
    const operand = this.parse_not()
    return { kind: 'unary', operator: 'not', operand, line: token.line, column: token.column }
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

  parse_identifier(): Identifier {
    const token = this.tokens.peek()
    if (token.kind !== 'identifier') throw this.tokens.error_at(token, 'name')
    this.tokens.next()
    return { kind: 'identifier', name: token.text, line: token.line, column: token.column }
  }

  // `(` starts a function literal when its closing `)` is followed by `:` or `->`.
  private starts_function_literal(): boolean {
    if (this.tokens.peek().kind === '->') return true
    if (this.tokens.peek().kind !== '(') return false
    let depth = 0
    for (let offset = 0; ; offset++) {
      const kind = this.tokens.peek(offset).kind
      if (kind === '(') depth++
      if (kind === ')') depth--
      if (depth === 0) return [':', '->'].includes(this.tokens.peek(offset + 1).kind)
      if (kind === 'newline' || kind === 'eof') return false
    }
  }

  // `(a: Int, b: Int): Int -> body`; the parameters and the return type may be omitted.
  private parse_function_literal(): FunctionLiteral {
    const token = this.tokens.peek()
    const params: Parameter[] = []
    if (this.tokens.accept('(') && !this.tokens.accept(')')) {
      do {
        const name = this.parse_identifier()
        this.tokens.expect(':', "':'")
        params.push({ name, type: this.parse_type_name() })
      } while (this.tokens.accept(','))
      this.tokens.expect(')', "')'")
    }
    const return_type = this.tokens.accept(':') ? this.parse_type_name() : undefined
    this.tokens.expect('->', "'->'")
    const body =
      this.tokens.peek().kind === 'newline'
        ? this.bodies.parse_block()
        : [this.bodies.parse_simple_statement()]
    return { kind: 'function', params, return_type, body, line: token.line, column: token.column }
  }

  parse_type_name(): TypeName {
    const { name, line, column } = this.parse_identifier()
    const args: TypeName[] = []
    if (this.tokens.accept('<')) {
      do args.push(this.parse_type_name())
      while (this.tokens.accept(','))
      this.tokens.expect('>', "'>'")
    }
    const optional = this.tokens.accept('?')
    return { kind: 'type_name', name, args, optional, line, column }
  }

  // Calls `f(x)`, indexing `xs[i]`, member accesses `x.name` and unwrapping `x!`, written without
  // a space before `(`, `[`, `.` or `!`.
  private parse_postfix(primary: Expression): Expression {
    let expression = primary
    for (;;) {
      const token = this.tokens.peek()
      if (token.spaced || !['(', '[', '.', '!'].includes(token.kind)) return expression
      this.tokens.next()
      const position = { line: expression.line, column: expression.column }
      if (token.kind === '!') {
        expression = { kind: 'unwrap', operand: expression, ...position }
      } else if (token.kind === '(') {
        const args = this.parse_parenthesized_arguments()
        expression = { kind: 'call', callee: expression, args, ...position }
      } else if (token.kind === '[') {
        const index = this.parse_expression()
        this.tokens.expect(']', "']'")
        expression = { kind: 'index', object: expression, index, ...position }
      } else {
        expression = {
          kind: 'member',
          object: expression,
          name: this.parse_identifier(),
          ...position,
        }
      }
    }
  }

  // `[a, b, c]` on one line; `[]` is empty.
  private parse_array_literal(position: Position): Expression {
    const elements: Expression[] = []
    if (!this.tokens.accept(']')) {
      do elements.push(this.parse_expression())
      while (this.tokens.accept(','))
      this.tokens.expect(']', "']'")
    }
    return { kind: 'array', elements, ...position }
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
    if (this.starts_function_literal()) return this.parse_function_literal()
    const token = this.tokens.next()
    const position = { line: token.line, column: token.column }
    if (token.kind === 'identifier') return { kind: 'identifier', name: token.text, ...position }
    if (token.kind === 'string') return { kind: 'string', value: token.text, ...position }
    if (token.kind === 'interpolated') {
      const parts = token.parts!.map((part) =>
        part.kind === 'text'
          ? part.text
          : parse_interpolated_code(part.source, token.line, part.column),
      )
      return { kind: 'interpolation', parts, ...position }
    }
    if (token.kind === 'nil') return { kind: 'nil', ...position }
    if (token.kind === 'true' || token.kind === 'false') {
      return { kind: 'boolean', value: token.kind === 'true', ...position }
    }
    if (token.kind === 'case') return this.parse_case(position)
    if (token.kind === '[') return this.parse_array_literal(position)
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

// Interpolated code is one expression; a function literal, whose body is made of statements,
// cannot be written there.
const no_bodies = (line: number, column: number): BodyParser => {
  const reject = (): never => {
    throw new CompileError('a function cannot be written in an interpolation', line, column)
  }
  return { parse_block: reject, parse_simple_statement: reject }
}

const parse_interpolated_code = (source: string, line: number, column: number): Expression => {
  const tokens = new TokenStream(tokenize_fragment(source, line, column))
  const expression = new ExpressionParser(tokens, no_bodies(line, column)).parse_expression()
  tokens.expect('newline', 'end of interpolation')
  return expression
}
