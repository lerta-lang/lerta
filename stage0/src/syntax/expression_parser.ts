import {
  comparison_operators,
  type ArithmeticOperator,
  type Call,
  type ComparisonOperator,
  type Expression,
  type Identifier,
  type NamedArgument,
  type RecordLiteral,
  type TypeName,
} from './ast.ts'
import { CompileError } from '../errors.ts'
import { BlockLiteralParser } from './block_literal_parser.ts'
import { CompoundParser, type BodyParser } from './compound_parser.ts'
import { integer_value, PrimaryParser } from './primary_parser.ts'
import type { TokenStream } from './token_stream.ts'
import { TypeParser } from './type_parser.ts'

// Arithmetic operators by precedence, weakest first. Comparisons are weaker than all of them.
const arithmetic_precedence: ArithmeticOperator[][] = [
  ['+', '-'],
  ['*', '/', '%'],
]

export type Arguments = { args: Expression[]; named_args: NamedArgument[] }

// `for x in xs`, with `when guard` after it if there is one.
export type LoopHeader = {
  variable: Identifier
  iterable: Expression
  guard: Expression | undefined
}

// Expressions, from the weakest operators down to primaries, which are read by the primary parser,
// as compound expressions are by the compound parser.
export class ExpressionParser {
  private readonly tokens: TokenStream

  readonly compounds: CompoundParser

  readonly primaries: PrimaryParser

  private readonly block_literals: BlockLiteralParser

  // Shared with the statement parser, for the types of declarations.
  readonly types: TypeParser

  constructor(tokens: TokenStream, bodies: BodyParser) {
    this.tokens = tokens
    this.compounds = new CompoundParser(tokens, this, bodies)
    this.primaries = new PrimaryParser(tokens, this, this.compounds)
    this.block_literals = new BlockLiteralParser(tokens, this)
    this.types = new TypeParser(tokens, this)
  }

  parse_expression(): Expression {
    return this.parse_conditional()
  }

  // The value after `=` or `key:`, which may be a literal in an indented block on the next lines.
  parse_value(): Expression {
    return this.block_literals.starts_block()
      ? this.block_literals.parse()
      : this.parse_expression()
  }

  // `f`, or `f x`, followed by an indented block of `name: value` lines: its named arguments.
  parse_block_arguments(callee: Expression): Call {
    const call: Call =
      callee.kind === 'call'
        ? callee
        : {
            kind: 'call',
            callee,
            args: [],
            named_args: [],
            type_args: [],
            line: callee.line,
            column: callee.column,
          }
    // The block starts with a `name:` line, so it is an anonymous struct.
    const block = this.block_literals.parse() as RecordLiteral
    if (call.named_args.length > 0) {
      const message = 'named arguments are all on the line or all in the indented block'
      throw new CompileError(message, block.line, block.column)
    }
    call.named_args = block.fields
    return call
  }

  starts_block_arguments(): boolean {
    return this.block_literals.starts_field_block()
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
  parse_coalesce(): Expression {
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
      const type = this.types.parse_named_type()
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
    if (token.kind !== '-') return this.parse_postfix(this.primaries.parse_primary())
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

  // Calls `f(x)`, indexing `xs[i]`, member accesses `x.name` and unwrapping `x!`, written without
  // a space before `(`, `[`, `.` or `!`; and calls with type arguments, `f<Int>(x)`.
  private parse_postfix(primary: Expression): Expression {
    let expression = primary
    for (;;) {
      const token = this.tokens.peek()
      const position = { line: expression.line, column: expression.column }
      if (expression.kind === 'identifier' && this.types.starts_type_arguments()) {
        const type_args = this.types.parse_type_arguments()
        this.tokens.next()
        const { args, named_args } = this.parse_parenthesized_arguments()
        expression = { kind: 'call', callee: expression, args, named_args, type_args, ...position }
        continue
      }
      if (token.spaced || !['(', '[', '.', '!'].includes(token.kind)) return expression
      this.tokens.next()
      if (token.kind === '!') {
        expression = { kind: 'unwrap', operand: expression, ...position }
      } else if (token.kind === '(') {
        const { args, named_args } = this.parse_parenthesized_arguments()
        const type_args: TypeName[] = []
        expression = { kind: 'call', callee: expression, args, named_args, type_args, ...position }
      } else if (token.kind === '[') {
        const index = this.parse_index()
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

  // The items of a list after its opening bracket, through `close`. Items are separated by a comma,
  // which the next item follows on the same line, or by a line end.
  parse_list<T>(close: ')' | ']' | '}', parse_item: () => T): T[] {
    return this.tokens.inside('separate', () => {
      this.tokens.accept('line_break')
      return this.parse_list_rest(close, parse_item, [])
    })
  }

  // The rest of a list whose first items are `items`, through `close`.
  parse_list_rest<T>(close: ')' | ']' | '}', parse_item: () => T, items: T[]): T[] {
    if (items.length > 0 && !this.ends_item(close)) return items
    while (!this.tokens.accept(close)) {
      items.push(parse_item())
      if (!this.ends_item(close)) break
    }
    return items
  }

  // After an item: whether a separator, which is consumed, follows it; otherwise the closing
  // bracket must, and is consumed.
  private ends_item(close: ')' | ']' | '}'): boolean {
    if (this.tokens.accept(',')) {
      const next = this.tokens.peek()
      if (next.kind === 'line_break' || next.kind === close) {
        throw this.tokens.error_at(next, "an item after ','")
      }
      return true
    }
    if (this.tokens.accept('line_break')) return true
    this.tokens.expect(close, `'${close}'`)
    return false
  }

  // The index after `[`, through `]`; line ends inside are skipped.
  private parse_index(): Expression {
    return this.tokens.inside('skip', () => {
      const expression = this.parse_expression()
      this.tokens.expect(']', "']'")
      return expression
    })
  }

  // `for x in xs`, with `when guard` after it if there is one.
  parse_loop_header(): LoopHeader {
    this.tokens.expect('for', "'for'")
    const variable = this.parse_identifier()
    this.tokens.expect('in', "'in'")
    const iterable = this.parse_expression()
    const guard = this.tokens.accept('when') ? this.parse_expression() : undefined
    return { variable, iterable, guard }
  }

  // The arguments after an opening parenthesis, through the closing one.
  private parse_parenthesized_arguments(): Arguments {
    return to_arguments(this.parse_list(')', () => this.parse_argument()))
  }

  // Arguments separated by commas, to the end of the line, as a call without parentheses has.
  parse_arguments(): Arguments {
    const items = [this.parse_argument()]
    while (this.tokens.peek_continuation() === ',' && this.tokens.next()) {
      const next = this.tokens.peek()
      if (next.kind === 'newline') throw this.tokens.error_at(next, "an item after ','")
      items.push(this.parse_argument())
    }
    return to_arguments(items)
  }

  private parse_argument(): Argument {
    const is_named = this.tokens.peek().kind === 'identifier' && this.tokens.peek(1).kind === ':'
    if (!is_named) return { name: undefined, value: this.parse_expression() }
    const name = this.parse_identifier()
    this.tokens.next()
    return { name, value: this.parse_value() }
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
