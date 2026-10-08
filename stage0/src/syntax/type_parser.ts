// Type names: named types, unions, function types and anonymous structs.
import type { Identifier, NamedType, RecordTypeName, TypeName } from './ast.ts'
import type { TokenKind } from './lexer.ts'
import type { TokenStream } from './token_stream.ts'

// The tokens that a type name is made of.
const type_token_kinds: TokenKind[] = [
  'identifier',
  '<',
  '>',
  ',',
  '?',
  '|',
  '(',
  ')',
  '->',
  '{',
  '}',
  ':',
]

// Names and lists in types are read as in expressions, by the expression parser.
export type ItemParser = {
  parse_identifier(): Identifier
  parse_list<T>(close: ')' | ']' | '}', parse_item: () => T): T[]
}

export class TypeParser {
  private readonly tokens: TokenStream

  private readonly items: ItemParser

  constructor(tokens: TokenStream, items: ItemParser) {
    this.tokens = tokens
    this.items = items
  }

  // A named type, or a union of them: `A | B`.
  parse_type_name(): TypeName {
    if (this.tokens.peek().kind === '(') return this.parse_parenthesized_type()
    const first = this.parse_union_member()
    if (this.tokens.peek().kind !== '|') return first
    const members = [first]
    while (this.tokens.accept('|')) members.push(this.parse_union_member())
    return { kind: 'union_type', members, line: first.line, column: first.column }
  }

  // `(A, B) -> R`, or a function type in parentheses, `((A) -> R)?`, to make it optional.
  private parse_parenthesized_type(): TypeName {
    const open = this.tokens.next()
    const position = { line: open.line, column: open.column }
    const types = this.items.parse_list(')', () => this.parse_type_name())
    if (this.tokens.accept('->')) {
      const result = this.parse_type_name()
      return { kind: 'function_type', params: types, result, optional: false, ...position }
    }
    const [inner] = types
    if (types.length !== 1 || inner.kind !== 'function_type') {
      throw this.tokens.error_at(this.tokens.peek(), "'->'")
    }
    return { ...inner, optional: this.tokens.accept('?'), ...position }
  }

  // A type that `|` can join: a named type or an anonymous struct, which the checker rejects as a
  // member so far.
  private parse_union_member(): NamedType | RecordTypeName {
    return this.tokens.peek().kind === '{' ? this.parse_record_type() : this.parse_named_type()
  }

  // `{ x: Int, y: String }`, with `?` after it if it may be nil.
  private parse_record_type(): RecordTypeName {
    const open = this.tokens.next()
    const fields = this.items.parse_list('}', () => {
      const name = this.items.parse_identifier()
      this.tokens.expect(':', "':'")
      return { name, type: this.parse_type_name() }
    })
    const optional = this.tokens.accept('?')
    return { kind: 'record_type', fields, optional, line: open.line, column: open.column }
  }

  parse_named_type(): NamedType {
    const { name, line, column } = this.items.parse_identifier()
    const args = this.tokens.peek().kind === '<' ? this.parse_type_arguments() : []
    const optional = this.tokens.accept('?')
    return { kind: 'type_name', name, args, optional, line, column }
  }

  // `<A, B>`.
  parse_type_arguments(): TypeName[] {
    this.tokens.expect('<', "'<'")
    const args: TypeName[] = []
    do args.push(this.parse_type_name())
    while (this.tokens.accept(','))
    this.tokens.expect('>', "'>'")
    return args
  }

  // Whether type arguments follow, written without a space and followed by `(`, as in `f<Int>(x)`.
  // Comparisons do not chain, so `a<b>(c)` cannot be read otherwise.
  starts_type_arguments(): boolean {
    const open = this.tokens.peek()
    if (open.kind !== '<' || open.spaced) return false
    let depth = 0
    for (let offset = 0; ; offset++) {
      const { kind } = this.tokens.peek(offset)
      if (!type_token_kinds.includes(kind)) return false
      if (kind === '<') depth++
      if (kind === '>') depth--
      if (depth === 0) {
        const next = this.tokens.peek(offset + 1)
        return next.kind === '(' && !next.spaced
      }
    }
  }
}
