import {
  assignment_operators,
  type AssignmentOperator,
  type Call,
  type Condition,
  type Declaration,
  type MemberDeclaration,
  type Expression,
  type For,
  type If,
  type Import,
  type Program,
  type Return,
  type Statement,
  type TypeAlias,
  type TypeDeclaration,
  type While,
} from './ast.ts'
import { CompileError } from './errors.ts'
import { ExpressionParser } from './expression_parser.ts'
import type { Token } from './lexer.ts'
import { TokenStream } from './token_stream.ts'

export const parse = (tokens: Token[]): Program =>
  new Parser(new TokenStream(tokens)).parse_program()

const command_argument_starts = [
  'identifier',
  'integer',
  'string',
  'interpolated',
  'true',
  'false',
  'nil',
  'not',
  'case',
  '->',
  '@',
  'throw',
]

// Statements: the program, blocks, declarations, assignments, control flow and calls without
// parentheses.
class Parser {
  private readonly tokens: TokenStream
  private readonly expressions: ExpressionParser

  constructor(tokens: TokenStream) {
    this.tokens = tokens
    this.expressions = new ExpressionParser(tokens, this)
  }

  parse_program(): Program {
    return this.parse_statements('eof')
  }

  // Statements, one per line, up to the token that ends the block.
  private parse_statements(end: 'eof' | 'dedent'): Statement[] {
    const statements: Statement[] = []
    while (this.tokens.peek().kind !== end && this.tokens.peek().kind !== 'eof') {
      statements.push(this.parse_statement())
      this.tokens.expect_line_end()
    }
    return statements
  }

  // A newline and an indented block of statements.
  parse_block(): Statement[] {
    this.tokens.expect('newline', 'end of line')
    this.tokens.expect('indent', 'indented block')
    const statements = this.parse_statements('dedent')
    this.tokens.expect('dedent', 'end of block')
    return statements
  }

  private parse_statement(): Statement {
    switch (this.tokens.peek().kind) {
      case 'for':
        return this.parse_for()
      case 'while':
        return this.parse_while()
      case 'if':
        return this.parse_if()
      case 'class':
      case 'struct':
        return this.parse_type_declaration()
      case 'import':
        return this.parse_import()
      default:
        if (this.at_type_alias()) return this.parse_type_alias()
        return this.parse_postfix_conditions(this.parse_simple_statement())
    }
  }

  // A statement that fits on one line, which postfix `if` and `while` can follow.
  parse_simple_statement(): Statement {
    const token = this.tokens.peek()
    const position = { line: token.line, column: token.column }
    if (token.kind === 'break' || token.kind === 'continue') {
      this.tokens.next()
      return { kind: token.kind, ...position }
    }
    if (token.kind === 'return') return this.parse_return()
    if (token.kind === 'const' || token.kind === 'var') return this.parse_declaration()
    const is_command_call =
      token.kind === 'identifier' && this.starts_command_argument(this.tokens.peek(1))
    if (is_command_call) return this.parse_command_call()
    const expression = this.expressions.parse_expression()
    const operator = this.tokens.peek_continuation()
    if (!(assignment_operators as readonly string[]).includes(operator)) return expression
    return this.parse_assignment(expression, operator as AssignmentOperator)
  }

  // `statement if condition` and `statement while condition`, applied from left to right.
  private parse_postfix_conditions(statement: Statement): Statement {
    let result = statement
    for (;;) {
      const token = this.tokens.peek()
      const kind = this.tokens.peek_continuation()
      if (kind !== 'if' && kind !== 'while') return result
      if (result.kind === 'declaration') {
        const message = `a declaration cannot have a postfix '${token.kind}'`
        throw new CompileError(message, token.line, token.column)
      }
      this.tokens.next()
      const condition = this.expressions.parse_expression()
      const position = { line: result.line, column: result.column }
      result =
        token.kind === 'if'
          ? { kind: 'if', condition, then_body: [result], else_body: [], ...position }
          : { kind: 'while', condition, body: [result], ...position }
    }
  }

  // `return` alone ends a function without a value.
  private parse_return(): Return {
    const token = this.tokens.next()
    const ends_statement = ['newline', 'dedent', 'eof', 'if', 'while'].includes(
      this.tokens.peek_continuation(),
    )
    const value = ends_statement ? undefined : this.expressions.parse_expression()
    return { kind: 'return', value, line: token.line, column: token.column }
  }

  private parse_declaration(): Declaration {
    const token = this.tokens.next()
    const name = this.expressions.parse_identifier()
    const type = this.tokens.accept(':') ? this.expressions.parse_type_name() : undefined
    this.tokens.expect('=', "'='")
    const value = this.expressions.parse_expression()
    const mutable = token.kind === 'var'
    const position = { line: token.line, column: token.column }
    return { kind: 'declaration', mutable, name, type, value, ...position }
  }

  private parse_assignment(target: Expression, operator: AssignmentOperator): Statement {
    if (target.kind !== 'identifier' && target.kind !== 'index' && target.kind !== 'member') {
      const message = 'only a name, an indexed item or a field can be assigned to'
      throw new CompileError(message, target.line, target.column)
    }
    this.tokens.next()
    const value = this.expressions.parse_expression()
    return { kind: 'assignment', operator, target, value, line: target.line, column: target.column }
  }

  // A call without parentheses, allowed only at the start of a statement.
  // `f -1` is `f(-1)`, but `f - 1` is a subtraction.
  private starts_command_argument(token: Token): boolean {
    if (!token.spaced) return false
    if (token.kind === '-') return !this.tokens.peek(2).spaced
    return ['(', '[', '{', ...command_argument_starts].includes(token.kind)
  }

  // `f x, y`: the arguments run to the end of the line.
  private parse_command_call(): Call {
    const callee = this.expressions.parse_primary()
    const { args, named_args } = this.expressions.parse_arguments()
    return { kind: 'call', callee, args, named_args, line: callee.line, column: callee.column }
  }

  // `type Name = ...`; `type` is not a keyword, so that it stays usable as a name.
  private at_type_alias(): boolean {
    const [first, second, third] = [0, 1, 2].map((offset) => this.tokens.peek(offset))
    const starts_with_type = first.kind === 'identifier' && first.text === 'type'
    return starts_with_type && second.kind === 'identifier' && third.kind === '='
  }

  private parse_type_alias(): TypeAlias {
    const token = this.tokens.next()
    const name = this.expressions.parse_identifier()
    this.tokens.expect('=', "'='")
    const type = this.expressions.parse_type_name()
    return { kind: 'type_alias', name, type, line: token.line, column: token.column }
  }

  // `import { a, b } from 'module'`. `from` is not a keyword, so that it stays usable as a name.
  private parse_import(): Import {
    const token = this.tokens.next()
    this.tokens.expect('{', "'{'")
    const names = [this.expressions.parse_identifier()]
    while (this.tokens.accept(',')) names.push(this.expressions.parse_identifier())
    this.tokens.expect('}', "'}'")
    const from = this.tokens.peek()
    if (from.kind !== 'identifier' || from.text !== 'from')
      throw this.tokens.error_at(from, "'from'")
    this.tokens.next()
    const module = this.tokens.peek()
    if (module.kind !== 'string') throw this.tokens.error_at(module, 'module name')
    this.tokens.next()
    return { kind: 'import', names, module: module.text, line: token.line, column: token.column }
  }

  // `class Name` or `struct Name` followed by an indented block of members, one per line.
  private parse_type_declaration(): TypeDeclaration {
    const token = this.tokens.next()
    const name = this.expressions.parse_identifier()
    this.tokens.expect('newline', 'end of line')
    this.tokens.expect('indent', 'indented members')
    const members: MemberDeclaration[] = []
    while (this.tokens.peek().kind !== 'dedent') {
      members.push(this.parse_member())
      this.tokens.expect_line_end()
    }
    this.tokens.next()
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

  // `[const | var] name[: Type][ = value]`, with a type, a value or both.
  private parse_member(): MemberDeclaration {
    const token = this.tokens.peek()
    const modifier = token.kind === 'const' || token.kind === 'var' ? token.kind : undefined
    if (modifier !== undefined) this.tokens.next()
    const name = this.expressions.parse_identifier()
    const type = this.tokens.accept(':') ? this.expressions.parse_type_name() : undefined
    const has_value = type === undefined || this.tokens.peek().kind === '='
    if (has_value) this.tokens.expect('=', type === undefined ? "':' or '='" : "'='")
    const value = has_value ? this.expressions.parse_expression() : undefined
    return { name, modifier, type, value, line: token.line, column: token.column }
  }

  // `for <name> in <expression>` followed by an indented block.
  private parse_for(): For {
    const token = this.tokens.next()
    const variable = this.expressions.parse_identifier()
    this.tokens.expect('in', "'in'")
    const iterable = this.expressions.parse_expression()
    const body = this.parse_block()
    return { kind: 'for', variable, iterable, body, line: token.line, column: token.column }
  }

  // A condition, or `const name = value`, which holds when the value is not nil.
  private parse_condition(): Condition {
    const token = this.tokens.peek()
    if (token.kind !== 'const') return this.expressions.parse_expression()
    this.tokens.next()
    const name = this.expressions.parse_identifier()
    this.tokens.expect('=', "'='")
    const value = this.expressions.parse_expression()
    return { kind: 'binding', name, value, line: token.line, column: token.column }
  }

  private parse_while(): While {
    const token = this.tokens.next()
    const condition = this.parse_condition()
    const body = this.parse_block()
    return { kind: 'while', condition, body, line: token.line, column: token.column }
  }

  // `if` with an optional `else` block; `else if` chains further.
  private parse_if(): If {
    const token = this.tokens.next()
    const condition = this.parse_condition()
    const then_body = this.parse_block()
    const position = { line: token.line, column: token.column }
    if (this.tokens.peek().kind !== 'else') {
      return { kind: 'if', condition, then_body, else_body: [], ...position }
    }
    this.tokens.next()
    const else_body = this.tokens.peek().kind === 'if' ? [this.parse_if()] : this.parse_block()
    return { kind: 'if', condition, then_body, else_body, ...position }
  }
}
