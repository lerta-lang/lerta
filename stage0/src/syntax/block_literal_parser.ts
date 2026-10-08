// A literal written as an indented block instead of in brackets, after a trailing `=` or `key:`.
// Its lines decide its kind: all `name: value` make an anonymous struct, all `key: value` a map,
// and plain values an array, one element per line.
import type { Expression, Identifier, Position } from './ast.ts'
import { CompileError } from '../errors.ts'
import type { TokenStream } from './token_stream.ts'

export type BlockElementParser = {
  parse_expression(): Expression
  parse_identifier(): Identifier
  // A line's value, which may open another block after its `key:`.
  parse_value(): Expression
}

type Line =
  | { kind: 'field'; name: Identifier; value: Expression }
  | { kind: 'entry'; key: Expression; value: Expression }
  | { kind: 'element'; value: Expression }

const kind_names = { field: 'fields', entry: 'map entries', element: 'array elements' }

export class BlockLiteralParser {
  private readonly tokens: TokenStream

  private readonly elements: BlockElementParser

  constructor(tokens: TokenStream, elements: BlockElementParser) {
    this.tokens = tokens
    this.elements = elements
  }

  // Whether the line ends here and an indented block follows.
  starts_block(): boolean {
    return this.tokens.peek().kind === 'newline' && this.tokens.peek(1).kind === 'indent'
  }

  // Whether the block that follows starts with a `name:` line, as a call's named arguments do.
  starts_field_block(): boolean {
    const [first, second] = [2, 3].map((offset) => this.tokens.peek(offset).kind)
    return this.starts_block() && first === 'identifier' && second === ':'
  }

  parse(): Expression {
    this.tokens.expect('newline', 'end of line')
    this.tokens.expect('indent', 'indented block')
    // Diagnostics about the literal point at its first line.
    const start = this.tokens.peek()
    const lines: Line[] = []
    while (this.tokens.peek().kind !== 'dedent') {
      const line_start = this.tokens.peek()
      const line = this.parse_line()
      if (lines.length > 0 && line.kind !== lines[0].kind) {
        const { line: at_line, column } = line_start
        const message = `the lines of this block are ${kind_names[lines[0].kind]}, so this one must be too`
        throw new CompileError(message, at_line, column)
      }
      lines.push(line)
      this.tokens.expect_line_end()
    }
    this.tokens.next()
    return to_literal(lines, { line: start.line, column: start.column })
  }

  private parse_line(): Line {
    const starts_field =
      this.tokens.peek().kind === 'identifier' && this.tokens.peek(1).kind === ':'
    if (starts_field) {
      const name = this.elements.parse_identifier()
      this.tokens.next()
      return { kind: 'field', name, value: this.elements.parse_value() }
    }
    const value = this.elements.parse_expression()
    if (!this.tokens.accept(':')) return { kind: 'element', value }
    return { kind: 'entry', key: value, value: this.elements.parse_value() }
  }
}

const to_literal = (lines: Line[], position: Position): Expression => {
  const fields = lines.flatMap((line) => (line.kind === 'field' ? [line] : []))
  const entries = lines.flatMap((line) => (line.kind === 'entry' ? [line] : []))
  const elements = lines.flatMap((line) => (line.kind === 'element' ? [line.value] : []))
  if (fields.length > 0) {
    return {
      kind: 'record',
      fields: fields.map(({ name, value }) => ({ name, value })),
      ...position,
    }
  }
  if (entries.length > 0) {
    return { kind: 'map', entries: entries.map(({ key, value }) => ({ key, value })), ...position }
  }
  return { kind: 'array', elements, ...position }
}
