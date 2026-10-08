import {
  assignment_operators,
  type AssignmentOperator,
  type Call,
  type Condition,
  type Declaration,
  type Destructuring,
  type Identifier,
  type Expression,
  type For,
  type If,
  type Program,
  type Statement,
  type While,
} from './ast.ts'
import { CompileError } from '../errors.ts'
import { DeclarationParser } from './declaration_parser.ts'
import { ExpressionParser } from './expression_parser.ts'
import type { Token } from './lexer.ts'
import { TokenStream } from './token_stream.ts'
import type { TypeParser } from './type_parser.ts'

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

// Statements: the program, blocks, `const` and `var` declarations, assignments, control flow and
// calls without parentheses; the other declarations are read by the declaration parser.
class Parser {
  private readonly tokens: TokenStream
  private readonly expressions: ExpressionParser
  private readonly types: TypeParser
  private readonly declarations: DeclarationParser

  constructor(tokens: TokenStream) {
    this.tokens = tokens
    this.expressions = new ExpressionParser(tokens, this)
    this.types = this.expressions.types
    this.declarations = new DeclarationParser(tokens, this.expressions, this)
  }

  parse_program(): Program {
    return this.parse_statements('eof')
  }

  // Statements, one per line, up to the token that ends the block.
  private parse_statements(end: 'eof' | 'dedent'): Statement[] {
    const statements: Statement[] = []
    while (this.tokens.peek().kind !== end && this.tokens.peek().kind !== 'eof') {
      statements.push(...expand_destructuring(this.parse_statement()))
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

  parse_statement(): Statement | Destructuring {
    switch (this.tokens.peek().kind) {
      case 'for':
        return this.parse_for()
      case 'while':
        return this.parse_while()
      case 'if':
        return this.parse_if()
      case 'class':
      case 'struct':
        return this.declarations.parse_type_declaration()
      case 'import':
        return this.declarations.parse_import()
      case 'export':
        return this.declarations.parse_export()
      case 'extern':
        return this.declarations.parse_extern()
      case 'extend':
        return this.declarations.parse_extend()
      default:
        if (this.declarations.starts_type_alias()) return this.declarations.parse_type_alias()
        if (this.at_declaration()) return this.reject_postfix(this.parse_declaration())
        return this.parse_postfix_conditions(this.parse_simple_statement())
    }
  }

  private at_declaration(): boolean {
    const { kind } = this.tokens.peek()
    return kind === 'const' || kind === 'var'
  }

  // A statement that fits on one line, which postfix `if` and `while` can follow, unless it is a
  // declaration.
  parse_simple_statement(): Statement {
    if (this.at_declaration()) {
      const declaration = this.parse_declaration()
      if (declaration.kind === 'declaration') return declaration
      const message = 'a destructuring declaration must be on a line of its own'
      throw new CompileError(message, declaration.line, declaration.column)
    }
    const token = this.tokens.peek()
    const is_command_call =
      token.kind === 'identifier' && this.starts_command_argument(this.tokens.peek(1))
    const expression = is_command_call
      ? this.parse_command_call()
      : this.expressions.parse_expression()
    const takes_block_arguments = ['call', 'identifier', 'member'].includes(expression.kind)
    if (takes_block_arguments && this.expressions.starts_block_arguments()) {
      return this.expressions.parse_block_arguments(expression)
    }
    if (is_command_call) return expression
    const operator = this.tokens.peek_continuation()
    if (!(assignment_operators as readonly string[]).includes(operator)) return expression
    return this.parse_assignment(expression, operator as AssignmentOperator)
  }

  // A declaration declares its names for the rest of the block, so no postfix `if` or `while` can
  // apply to it.
  private reject_postfix<T extends Statement | Destructuring>(declaration: T): T {
    const kind = this.tokens.peek_continuation()
    if (kind !== 'if' && kind !== 'while') return declaration
    const token = this.tokens.peek()
    throw new CompileError(
      `a declaration cannot have a postfix '${kind}'`,
      token.line,
      token.column,
    )
  }

  // `statement if condition`, `statement while condition` and `statement for x in xs when guard`,
  // applied from left to right.
  private parse_postfix_conditions(statement: Statement): Statement {
    let result = statement
    for (;;) {
      const token = this.tokens.peek()
      const kind = this.tokens.peek_continuation()
      if (kind === 'for') {
        result = this.wrap_in_for(result)
        continue
      }
      if (kind !== 'if' && kind !== 'while') return result
      this.tokens.next()
      const condition = this.expressions.parse_expression()
      const position = { line: result.line, column: result.column }
      result =
        token.kind === 'if'
          ? { kind: 'if', condition, then_body: [result], else_body: [], ...position }
          : { kind: 'while', condition, body: [result], ...position }
    }
  }

  private wrap_in_for(statement: Statement): For {
    const { variable, iterable, guard } = this.expressions.parse_loop_header()
    const position = { line: statement.line, column: statement.column }
    const body: Statement[] =
      guard === undefined
        ? [statement]
        : [{ kind: 'if', condition: guard, then_body: [statement], else_body: [], ...position }]
    return { kind: 'for', variable, iterable, body, ...position }
  }

  private parse_declaration(): Declaration | Destructuring {
    const token = this.tokens.next()
    if (this.tokens.peek().kind === '{') return this.parse_destructuring(token)
    const name = this.expressions.parse_identifier()
    const type = this.tokens.accept(':') ? this.types.parse_type_name() : undefined
    this.tokens.expect('=', "'='")
    const value = this.expressions.parse_value()
    const mutable = token.kind === 'var'
    const position = { line: token.line, column: token.column }
    return { kind: 'declaration', mutable, name, type, value, ...position }
  }

  // `const { a, b } = value`.
  private parse_destructuring(token: Token): Destructuring {
    this.tokens.next()
    const names = this.expressions.parse_list('}', () => this.expressions.parse_identifier())
    if (names.length === 0) throw this.tokens.error_at(this.tokens.peek(), 'a name')
    this.tokens.expect('=', "'='")
    const value = this.expressions.parse_expression()
    const position = { line: token.line, column: token.column }
    return { kind: 'destructuring', mutable: token.kind === 'var', names, value, ...position }
  }

  private parse_assignment(target: Expression, operator: AssignmentOperator): Statement {
    if (target.kind !== 'identifier' && target.kind !== 'index' && target.kind !== 'member') {
      const message = 'only a name, an indexed item or a field can be assigned to'
      throw new CompileError(message, target.line, target.column)
    }
    this.tokens.next()
    const value = this.expressions.parse_value()
    return { kind: 'assignment', operator, target, value, line: target.line, column: target.column }
  }

  // A call without parentheses, allowed only at the start of a statement.
  // `f -1` is `f(-1)`, but `f - 1` is a subtraction.
  private starts_command_argument(token: Token): boolean {
    if (!token.spaced) return false
    if (token.kind === '-') return !this.tokens.peek(2).spaced
    // `is` is not a keyword, but `x is T` is a test, not a call of x.
    if (token.kind === 'identifier' && token.text === 'is') return false
    return ['(', '[', '{', ...command_argument_starts].includes(token.kind)
  }

  // `f x, y`: the arguments run to the end of the line.
  private parse_command_call(): Call {
    const callee = this.expressions.primaries.parse_primary()
    const { args, named_args } = this.expressions.parse_arguments()
    const position = { line: callee.line, column: callee.column }
    return { kind: 'call', callee, args, named_args, type_args: [], ...position }
  }

  // `for <name> in <expression>` followed by an indented block.
  private parse_for(): For {
    const token = this.tokens.peek()
    const { variable, iterable, guard } = this.expressions.parse_loop_header()
    if (guard !== undefined) {
      const message = "a for loop with a block has no 'when'; write an if in the block"
      throw new CompileError(message, guard.line, guard.column)
    }
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

// `const { a, b } = value` declares a const that cannot be named (`.` is not allowed in names),
// holding the value, then `a` and `b`, each from the field of its name.
const expand_destructuring = (statement: Statement | Destructuring): Statement[] => {
  if (statement.kind !== 'destructuring') return [statement]
  const { mutable, names, value, line, column } = statement
  const holder: Identifier = {
    kind: 'identifier',
    name: `destructured.${line}.${column}`,
    line,
    column,
  }
  const field = (name: Identifier): Expression => ({
    kind: 'member',
    object: { ...holder },
    name: { ...name },
    line: name.line,
    column: name.column,
  })
  const holder_declaration: Declaration = {
    kind: 'declaration',
    mutable: false,
    name: holder,
    type: undefined,
    value,
    line,
    column,
  }
  return [
    holder_declaration,
    ...names.map((name): Declaration => ({
      kind: 'declaration',
      mutable,
      name,
      type: undefined,
      value: field(name),
      line: name.line,
      column: name.column,
    })),
  ]
}
