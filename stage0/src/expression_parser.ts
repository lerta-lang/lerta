import {
  comparison_operators,
  type ArithmeticOperator,
  type Case,
  type CaseArm,
  type ComparisonOperator,
  type Expression,
  type FunctionLiteral,
  type Identifier,
  type NamedType,
  type NamedArgument,
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

export type Arguments = { args: Expression[]; named_args: NamedArgument[] }

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
    return this.parse_conditional()
  }

  // `c then a else b`, which binds weaker than the binary operators; `c then a else d then b else
  // e` is `c then a else (d then b else e)`.
  private parse_conditional(): Expression {
    const condition = this.parse_coalesce()
    if (this.tokens.peek_continuation() !== 'then') return condition
    this.tokens.next()
    const then_value = this.parse_conditional()
    this.tokens.expect('else', "'else'")
    const else_value = this.parse_conditional()
    const position = { line: condition.line, column: condition.column }
    return { kind: 'conditional', condition, then_value, else_value, ...position }
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
    if (this.at_is()) {
      this.tokens.next()
      const type = this.parse_named_type()
      return { kind: 'is', value: left, type, line: left.line, column: left.column }
    }
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

  // `is` is not a keyword, so that it stays usable as a name.
  private at_is(): boolean {
    const token = this.tokens.peek()
    return this.tokens.peek_continuation() === 'identifier' && token.text === 'is'
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

  // `(` starts a function literal when it opens typed parameters, `(a: Int`, or when its closing
  // `)` is followed by `->`, or by `:` after `()`. A parenthesized expression followed by `:` is a
  // map key: `{ (k): v }`.
  // The lookahead skips line breaks, which may separate the parameters.
  private starts_function_literal(): boolean {
    return this.tokens.inside('skip', () => this.looks_like_function_literal())
  }

  private looks_like_function_literal(): boolean {
    const [first, second, third] = [0, 1, 2].map((offset) => this.tokens.peek(offset).kind)
    if (first === '->') return true
    if (first !== '(') return false
    if (second === ')') return third === ':' || third === '->'
    if (second === 'identifier' && third === ':') return true
    let depth = 0
    for (let offset = 0; ; offset++) {
      const kind = this.tokens.peek(offset).kind
      if (kind === '(') depth++
      if (kind === ')') depth--
      if (depth === 0) return this.tokens.peek(offset + 1).kind === '->'
      if (kind === 'newline' || kind === 'eof') return false
    }
  }

  // `(a: Int, b: Int): Int -> body`; the parameters and the return type may be omitted.
  private parse_function_literal(): FunctionLiteral {
    const token = this.tokens.peek()
    const params: Parameter[] = []
    if (this.tokens.accept('(')) {
      const parse_param = () => {
        const name = this.parse_identifier()
        this.tokens.expect(':', "':'")
        return { name, type: this.parse_type_name() }
      }
      params.push(...this.parse_list(')', parse_param))
    }
    const return_type = this.tokens.accept(':') ? this.parse_type_name() : undefined
    this.tokens.expect('->', "'->'")
    const body =
      this.tokens.peek().kind === 'newline'
        ? this.bodies.parse_block()
        : [this.bodies.parse_simple_statement()]
    return { kind: 'function', params, return_type, body, line: token.line, column: token.column }
  }

  // A named type, or a union of them: `A | B`.
  parse_type_name(): TypeName {
    const first = this.parse_named_type()
    if (this.tokens.peek().kind !== '|') return first
    const members = [first]
    while (this.tokens.accept('|')) members.push(this.parse_named_type())
    return { kind: 'union_type', members, line: first.line, column: first.column }
  }

  private parse_named_type(): NamedType {
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
        const { args, named_args } = this.parse_parenthesized_arguments()
        expression = { kind: 'call', callee: expression, args, named_args, ...position }
      } else if (token.kind === '[') {
        const index = this.parse_grouped(']')
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

  // `@` is the object; `@x`, written without a space, is its member x.
  private parse_this(position: Position): Expression {
    const object: Expression = { kind: 'this', ...position }
    const next = this.tokens.peek()
    if (next.kind !== 'identifier' || next.spaced) return object
    return { kind: 'member', object, name: this.parse_identifier(), ...position }
  }

  // The items of a list after its opening bracket, through `close`. Items are separated by commas
  // or line ends, and the last may be followed by either.
  parse_list<T>(close: ')' | ']' | '}', parse_item: () => T): T[] {
    return this.tokens.inside('separate', () => {
      const items: T[] = []
      this.tokens.accept('line_break')
      while (!this.tokens.accept(close)) {
        items.push(parse_item())
        const has_comma = this.tokens.accept(',')
        const is_separated = this.tokens.accept('line_break') || has_comma
        if (!is_separated) {
          this.tokens.expect(close, `'${close}'`)
          break
        }
      }
      return items
    })
  }

  // The contents of a grouping or an index, through `close`; line ends inside are skipped.
  private parse_grouped(close: ')' | ']'): Expression {
    return this.tokens.inside('skip', () => {
      const expression = this.parse_expression()
      this.tokens.expect(close, `'${close}'`)
      return expression
    })
  }

  // `[a, b, c]`; `[]` is empty.
  private parse_array_literal(position: Position): Expression {
    const elements = this.parse_list(']', () => this.parse_expression())
    return { kind: 'array', elements, ...position }
  }

  // `{ k: v, ... }`. A key that is a name would make an anonymous struct, so a name's value is
  // written as a key in parentheses: `{ (k): v }`.
  private parse_map_literal(position: Position): Expression {
    const entries = this.parse_list('}', () => {
      const token = this.tokens.peek()
      if (token.kind === 'identifier' && this.tokens.peek(1).kind === ':') {
        const message = `anonymous structs are not supported yet; for the value of '${token.text}' as a key, write (${token.text})`
        throw new CompileError(message, token.line, token.column)
      }
      const key = this.parse_expression()
      this.tokens.expect(':', "':'")
      return { key, value: this.parse_expression() }
    })
    if (entries.length === 0) {
      throw new CompileError('the empty map is written `Map()`', position.line, position.column)
    }
    return { kind: 'map', entries, ...position }
  }

  // The arguments after an opening parenthesis, through the closing one.
  private parse_parenthesized_arguments(): Arguments {
    return to_arguments(this.parse_list(')', () => this.parse_argument()))
  }

  // Arguments separated by commas, to the end of the line, as a call without parentheses has.
  parse_arguments(): Arguments {
    const items = [this.parse_argument()]
    while (this.tokens.peek_continuation() === ',' && this.tokens.next()) {
      items.push(this.parse_argument())
    }
    return to_arguments(items)
  }

  private parse_argument(): Argument {
    const is_named = this.tokens.peek().kind === 'identifier' && this.tokens.peek(1).kind === ':'
    if (!is_named) return { name: undefined, value: this.parse_expression() }
    const name = this.parse_identifier()
    this.tokens.next()
    return { name, value: this.parse_expression() }
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
    if (token.kind === 'throw')
      return { kind: 'throw', message: this.parse_expression(), ...position }
    if (token.kind === '@') return this.parse_this(position)
    if (token.kind === 'true' || token.kind === 'false') {
      return { kind: 'boolean', value: token.kind === 'true', ...position }
    }
    if (token.kind === 'case') return this.parse_case(position)
    if (token.kind === '[') return this.parse_array_literal(position)
    if (token.kind === '{') return this.parse_map_literal(position)
    if (token.kind === 'integer')
      return { kind: 'integer', value: integer_value(BigInt(token.text), position), ...position }
    if (token.kind === '(') {
      const expression = this.parse_grouped(')')
      // Diagnostics about the group point at its opening parenthesis.
      return { ...expression, ...position }
    }
    throw this.tokens.error_at(token, 'expression')
  }

  // `case` followed by an indented block of `when` arms and a final `else` arm.
  // With a subject, an arm may list several patterns, and the `else` arm may be left out (whether
  // it may is checked later).
  private parse_case(position: Position): Case {
    const subject = this.tokens.peek().kind === 'newline' ? undefined : this.parse_expression()
    this.tokens.expect('newline', 'end of line')
    this.tokens.expect('indent', "indented 'when' arms")
    const arms: CaseArm[] = []
    do {
      this.tokens.expect('when', "'when'")
      // A pattern stops before `then`, which begins the arm's value.
      const patterns = [this.parse_coalesce()]
      while (subject !== undefined && this.tokens.accept(',')) patterns.push(this.parse_coalesce())
      arms.push({ patterns, body: this.parse_arm_body('then') })
    } while (this.tokens.peek().kind === 'when')
    const has_else = subject === undefined || this.tokens.peek().kind === 'else'
    if (has_else) this.tokens.expect('else', "'when' or 'else'")
    const otherwise = has_else ? this.parse_arm_body('else') : undefined
    this.tokens.expect('dedent', 'end of block')
    return { kind: 'case', subject, arms, otherwise, ...position }
  }

  // The expression on the same line (`when c then x`, `else x`), or alone in an indented block.
  private parse_arm_body(arm: 'then' | 'else'): Statement[] {
    const is_inline =
      arm === 'then' ? this.tokens.accept('then') : this.tokens.peek().kind !== 'newline'
    if (is_inline) {
      const value = this.parse_expression()
      this.tokens.expect_line_end()
      return [value]
    }
    if (this.tokens.peek().kind !== 'newline') {
      throw this.tokens.error_at(this.tokens.peek(), "'then' or end of line")
    }
    return this.bodies.parse_block()
  }
}

type Argument = { name: Identifier | undefined; value: Expression }

// Named arguments come last.
const to_arguments = (items: Argument[]): Arguments => {
  const args: Expression[] = []
  const named_args: NamedArgument[] = []
  for (const { name, value } of items) {
    if (name !== undefined) {
      named_args.push({ name, value })
    } else if (named_args.length > 0) {
      const message = 'a positional argument cannot follow a named one'
      throw new CompileError(message, value.line, value.column)
    } else {
      args.push(value)
    }
  }
  return { args, named_args }
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
