// Primary expressions: names, literals, `@`, jumps, and the compound expressions that the compound
// parser reads.
import type { Call, Expression, Identifier, Position } from './ast.ts'
import { CompileError } from '../errors.ts'
import type { CompoundParser, BodyParser } from './compound_parser.ts'
import { ExpressionParser } from './expression_parser.ts'
import { tokenize_fragment } from './lexer.ts'
import { TokenStream } from './token_stream.ts'

const INT_MIN = -(2n ** 63n)
const INT_MAX = 2n ** 63n - 1n

// The expressions that a primary is made of, or that follow it, are read by the expression parser.
export type OperandParser = {
  parse_expression(): Expression
  parse_identifier(): Identifier
}

export class PrimaryParser {
  private readonly tokens: TokenStream
  private readonly operands: OperandParser
  private readonly compounds: CompoundParser

  constructor(tokens: TokenStream, operands: OperandParser, compounds: CompoundParser) {
    this.tokens = tokens
    this.operands = operands
    this.compounds = compounds
  }

  parse_primary(): Expression {
    if (this.compounds.starts_function_literal()) return this.compounds.parse_function_literal()
    const token = this.tokens.next()
    const position = { line: token.line, column: token.column }
    if (token.kind === 'identifier') return { kind: 'identifier', name: token.text, ...position }
    if (token.kind === 'string') return { kind: 'string', value: token.text, ...position }
    if (token.kind === 'interpolated') {
      const parts = token.parts!.map((part) =>
        part.kind === 'text'
          ? part.text
          : to_string_call(parse_interpolated_code(part.source, token.line, part.column)),
      )
      return { kind: 'interpolation', parts, ...position }
    }
    if (token.kind === 'nil') return { kind: 'nil', ...position }
    if (token.kind === 'break' || token.kind === 'continue')
      return { kind: token.kind, ...position }
    if (token.kind === 'return') {
      const value = this.ends_expression() ? undefined : this.operands.parse_expression()
      return { kind: 'return', value, ...position }
    }
    if (token.kind === 'throw')
      return { kind: 'throw', message: this.operands.parse_expression(), ...position }
    if (token.kind === '@') return this.parse_this(position)
    if (token.kind === 'true' || token.kind === 'false') {
      return { kind: 'boolean', value: token.kind === 'true', ...position }
    }
    if (token.kind === 'case') return this.compounds.parse_case(position)
    if (token.kind === '[') return this.compounds.parse_array_literal(position)
    if (token.kind === '{') return this.compounds.parse_map_literal(position)
    if (token.kind === 'integer')
      return { kind: 'integer', value: integer_value(BigInt(token.text), position), ...position }
    if (token.kind === '(') return this.compounds.parse_parenthesized(position)
    throw this.tokens.error_at(token, 'expression')
  }

  // `@` is the object; `@x`, written without a space, is its member x. `@.x` would be a second
  // way to write it for no gain, so it is an error.
  private parse_this(position: Position): Expression {
    const object: Expression = { kind: 'this', ...position }
    const next = this.tokens.peek()
    if (next.kind === '.') throw new CompileError('write @x, not @.x', next.line, next.column)
    if (next.kind !== 'identifier' || next.spaced) return object
    return { kind: 'member', object, name: this.operands.parse_identifier(), ...position }
  }

  // Whether the next token ends the expression, so that `return` there has no value.
  private ends_expression(): boolean {
    const ends = [
      ...['newline', 'dedent', 'eof', 'line_break'],
      ...['if', 'while', 'then', 'else', ')', ']', '}', ','],
    ]
    return ends.includes(this.tokens.peek_continuation())
  }
}

export const integer_value = (value: bigint, position: Position): bigint => {
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

const to_string_call = (value: Expression): Call => {
  const position = { line: value.line, column: value.column }
  const name: Identifier = { kind: 'identifier', name: 'to_string', ...position }
  const callee: Expression = { kind: 'member', object: value, name, ...position }
  return { kind: 'call', callee, args: [], named_args: [], type_args: [], ...position }
}

const parse_interpolated_code = (source: string, line: number, column: number): Expression => {
  const tokens = new TokenStream(tokenize_fragment(source, line, column))
  const expression = new ExpressionParser(tokens, no_bodies(line, column)).parse_expression()
  tokens.expect('newline', 'end of interpolation')
  return expression
}
