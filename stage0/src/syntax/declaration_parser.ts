// Declarations other than `const` and `var`: type aliases, classes, structs, extends, imports,
// externs and exports.
import type {
  Destructuring,
  Extend,
  Extern,
  Import,
  ImportName,
  MemberDeclaration,
  Statement,
  TypeAlias,
  TypeDeclaration,
} from './ast.ts'
import { CompileError } from '../errors.ts'
import type { ExpressionParser } from './expression_parser.ts'
import type { TokenStream } from './token_stream.ts'
import type { TypeParser } from './type_parser.ts'

// What `export` applies to is a statement, which the statement parser reads.
export type StatementParser = {
  parse_statement(): Statement | Destructuring
}

export class DeclarationParser {
  private readonly tokens: TokenStream
  private readonly expressions: ExpressionParser
  private readonly types: TypeParser
  private readonly statements: StatementParser

  constructor(tokens: TokenStream, expressions: ExpressionParser, statements: StatementParser) {
    this.tokens = tokens
    this.expressions = expressions
    this.types = expressions.types
    this.statements = statements
  }

  // `type Name = ...`; `type` is not a keyword, so that it stays usable as a name.
  starts_type_alias(): boolean {
    const [first, second, third] = [0, 1, 2].map((offset) => this.tokens.peek(offset))
    const starts_with_type = first.kind === 'identifier' && first.text === 'type'
    return starts_with_type && second.kind === 'identifier' && third.kind === '='
  }

  parse_type_alias(): TypeAlias {
    const token = this.tokens.next()
    const name = this.expressions.parse_identifier()
    this.tokens.expect('=', "'='")
    const type = this.types.parse_type_name()
    return { kind: 'type_alias', name, type, line: token.line, column: token.column }
  }

  // `export` before a `const` (a function or a value) or a type; the checker tells whether it is at
  // the top level.
  parse_export(): Statement {
    const token = this.tokens.next()
    const statement = this.statements.parse_statement()
    const is_const = statement.kind === 'declaration' && !statement.mutable
    const is_exportable =
      is_const ||
      statement.kind === 'type_declaration' ||
      statement.kind === 'type_alias' ||
      statement.kind === 'extern'
    if (is_exportable) return { ...statement, exported: true }
    const message = 'only a const, a class, a struct, a type alias or an extern can be exported'
    throw new CompileError(message, token.line, token.column)
  }

  // `extern symbol as name: (A) -> R`.
  parse_extern(): Extern {
    const token = this.tokens.next()
    const symbol = this.expressions.parse_identifier()
    const next = this.tokens.peek()
    const has_name = next.kind === 'identifier' && next.text === 'as'
    if (has_name) this.tokens.next()
    const name = has_name ? this.expressions.parse_identifier() : symbol
    this.tokens.expect(':', "':'")
    const type = this.types.parse_type_name()
    return { kind: 'extern', symbol, name, type, line: token.line, column: token.column }
  }

  // `import { a, b } from 'module'`, or `import 'module'` for its effects alone. `from` is not a
  // keyword, so that it stays usable as a name.
  parse_import(): Import {
    const token = this.tokens.next()
    const position = { line: token.line, column: token.column }
    if (this.tokens.peek().kind === 'string') {
      return { kind: 'import', names: [], module: this.parse_module_name(), ...position }
    }
    this.tokens.expect('{', "'{' or module name")
    const first = this.tokens.peek()
    const names = this.expressions.parse_list('}', () => this.parse_import_name())
    if (names.length === 0) throw this.tokens.error_at(first, 'a name to import')
    const from = this.tokens.peek()
    if (from.kind !== 'identifier' || from.text !== 'from')
      throw this.tokens.error_at(from, "'from'")
    this.tokens.next()
    return { kind: 'import', names, module: this.parse_module_name(), ...position }
  }

  private parse_module_name(): string {
    const module = this.tokens.peek()
    if (module.kind !== 'string') throw this.tokens.error_at(module, 'module name')
    this.tokens.next()
    return module.text
  }

  // `name` or `name as alias`. `as` is not a keyword, so that it stays usable as a name.
  private parse_import_name(): ImportName {
    const name = this.expressions.parse_identifier()
    const next = this.tokens.peek()
    if (next.kind !== 'identifier' || next.text !== 'as') return { name, alias: undefined }
    this.tokens.next()
    return { name, alias: this.expressions.parse_identifier() }
  }

  // `class Name` or `struct Name` followed by an indented block of members, one per line.
  parse_type_declaration(): TypeDeclaration {
    const token = this.tokens.next()
    const name = this.expressions.parse_identifier()
    const members = this.parse_members()
    const is_struct = token.kind === 'struct'
    return {
      kind: 'type_declaration',
      is_struct,
      name,
      members,
      line: token.line,
      column: token.column,
    }
  }

  // `extend Type`, or `extend <T> Array<T>` for a generic one, followed by an indented block of
  // methods, one per line.
  parse_extend(): Extend {
    const token = this.tokens.next()
    const type_params =
      this.tokens.peek().kind === '<' ? this.expressions.compounds.parse_type_parameters() : []
    const type = this.types.parse_type_name()
    const members = this.parse_members()
    return { kind: 'extend', type_params, type, members, line: token.line, column: token.column }
  }

  private parse_members(): MemberDeclaration[] {
    this.tokens.expect('newline', 'end of line')
    this.tokens.expect('indent', 'indented members')
    const members: MemberDeclaration[] = []
    while (this.tokens.peek().kind !== 'dedent') {
      members.push(this.parse_member())
      this.tokens.expect_line_end()
    }
    this.tokens.next()
    return members
  }

  // `[const | var] name[: Type][ = value]`, with a type, a value or both.
  private parse_member(): MemberDeclaration {
    const token = this.tokens.peek()
    const modifier = token.kind === 'const' || token.kind === 'var' ? token.kind : undefined
    if (modifier !== undefined) this.tokens.next()
    const name = this.expressions.parse_identifier()
    const type = this.tokens.accept(':') ? this.types.parse_type_name() : undefined
    const has_value = type === undefined || this.tokens.peek().kind === '='
    if (has_value) this.tokens.expect('=', type === undefined ? "':' or '='" : "'='")
    const value = has_value ? this.expressions.parse_value() : undefined
    return { name, modifier, type, value, line: token.line, column: token.column }
  }
}
