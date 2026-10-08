// Compound expressions, made of other expressions or of blocks: arrays and comprehensions, maps and
// anonymous structs, function literals, and `case`.
import type {
  Case,
  CaseArm,
  Comprehension,
  Expression,
  FunctionLiteral,
  Identifier,
  Parameter,
  Position,
  Statement,
  TypeParameter,
} from './ast.ts'
import { CompileError } from '../errors.ts'
import type { LoopHeader } from './expression_parser.ts'
import type { TypeParser } from './type_parser.ts'
import type { TokenStream } from './token_stream.ts'

// Function bodies and the bodies of arms are statements, which the statement parser reads.
export type BodyParser = {
  parse_block(): Statement[]
  parse_simple_statement(): Statement
}

// The elements, entries and patterns are read by the expression parser.
export type ElementParser = {
  readonly types: TypeParser
  parse_expression(): Expression
  // An expression that stops before `then`, as a case arm's pattern does.
  parse_coalesce(): Expression
  parse_identifier(): Identifier
  parse_list<T>(close: ')' | ']' | '}', parse_item: () => T): T[]
  // The rest of a list whose first items are given.
  parse_list_rest<T>(close: ')' | ']' | '}', parse_item: () => T, items: T[]): T[]
  parse_loop_header(): LoopHeader
}

export class CompoundParser {
  private readonly tokens: TokenStream

  private readonly elements: ElementParser

  private readonly bodies: BodyParser

  constructor(tokens: TokenStream, elements: ElementParser, bodies: BodyParser) {
    this.tokens = tokens
    this.elements = elements
    this.bodies = bodies
  }

  // `(` starts a function literal when it opens typed parameters, `(a: Int`, or when its closing
  // `)` is followed by `->`, or by `:` after `()`. A parenthesized expression followed by `:` is a
  // map key: `{ (k): v }`. `<` starts the type parameters of a generic one.
  // The lookahead skips line breaks, which may separate the parameters.
  starts_function_literal(): boolean {
    return this.tokens.inside('skip', () => this.looks_like_function_literal())
  }

  private looks_like_function_literal(): boolean {
    const [first, second, third] = [0, 1, 2].map((offset) => this.tokens.peek(offset).kind)
    if (first === '->' || first === '<') return true
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

  // `(a: Int, b: Int): Int -> body`; the parameters and the return type may be omitted, and so may
  // the parameters' types, `(a, b) -> body`, where a function type is expected. Type parameters,
  // `<T, U: Stringable>`, come first.
  parse_function_literal(): FunctionLiteral {
    const token = this.tokens.peek()
    const type_params = this.tokens.peek().kind === '<' ? this.parse_type_parameters() : []
    const params: Parameter[] = []
    if (this.tokens.accept('(')) {
      const parse_param = () => {
        const name = this.elements.parse_identifier()
        return {
          name,
          type: this.tokens.accept(':') ? this.elements.types.parse_type_name() : undefined,
        }
      }
      params.push(...this.elements.parse_list(')', parse_param))
    }
    const return_type = this.tokens.accept(':') ? this.elements.types.parse_type_name() : undefined
    this.tokens.expect('->', "'->'")
    const body =
      this.tokens.peek().kind === 'newline'
        ? this.bodies.parse_block()
        : [this.bodies.parse_simple_statement()]
    const position = { line: token.line, column: token.column }
    return { kind: 'function', type_params, params, return_type, body, ...position }
  }

  private parse_type_parameters(): TypeParameter[] {
    this.tokens.expect('<', "'<'")
    const type_params: TypeParameter[] = []
    do {
      const name = this.elements.parse_identifier()
      const bound = this.tokens.accept(':') ? this.elements.parse_identifier() : undefined
      type_params.push({ name, bound })
    } while (this.tokens.accept(','))
    this.tokens.expect('>', "'>'")
    return type_params
  }

  // `[a, b, c]`; `[]` is empty. A first element followed by `for` makes a comprehension.
  parse_array_literal(position: Position): Expression {
    return this.tokens.inside('separate', () => {
      this.tokens.accept('line_break')
      if (this.tokens.accept(']')) return { kind: 'array', elements: [], ...position }
      const first = this.elements.parse_expression()
      const for_follows = (offset: number) => this.tokens.peek(offset).kind === 'for'
      if (this.tokens.peek().kind === 'line_break' && for_follows(1)) this.tokens.next()
      if (for_follows(0)) return this.parse_comprehension(first, position, ']')
      const parse_element = () => this.elements.parse_expression()
      const elements = this.elements.parse_list_rest(']', parse_element, [first])
      return { kind: 'array', elements, ...position }
    })
  }

  // `(a)`, or `(f(x) for x in xs when g(x))`, an Iter comprehension; line ends inside are skipped.
  parse_parenthesized(position: Position): Expression {
    return this.tokens.inside('skip', () => {
      const first = this.elements.parse_expression()
      if (this.tokens.peek().kind === 'for') return this.parse_comprehension(first, position, ')')
      this.tokens.expect(')', "')'")
      // Diagnostics about the group point at its opening parenthesis.
      return { ...first, ...position }
    })
  }

  // `for x in xs when guard]`, after the element, or `... guard)` for an Iter; line ends inside
  // are skipped.
  private parse_comprehension(
    element: Expression,
    position: Position,
    close: ']' | ')',
  ): Expression {
    return this.tokens.inside('skip', () => {
      const { variable, iterable, guard } = this.elements.parse_loop_header()
      this.tokens.expect(close, `'${close}'`)
      const lazy = close === ')' ? lazy_functions(element, variable, guard) : undefined
      return { kind: 'comprehension', element, variable, iterable, guard, lazy, ...position }
    })
  }

  // `{ k: v, ... }`. A key that is a name would make an anonymous struct, so a name's value is
  // written as a key in parentheses: `{ (k): v }`.
  parse_map_literal(position: Position): Expression {
    if (this.starts_record_field()) return this.parse_record_literal(position)
    const entries = this.elements.parse_list('}', () => {
      if (this.starts_record_field()) {
        const token = this.tokens.peek()
        const message = `a map's keys are values: for the value of '${token.text}', write (${token.text})`
        throw new CompileError(message, token.line, token.column)
      }
      const key = this.elements.parse_expression()
      this.tokens.expect(':', "':'")
      return { key, value: this.elements.parse_expression() }
    })
    if (entries.length === 0) {
      throw new CompileError('the empty map is written `Map()`', position.line, position.column)
    }
    return { kind: 'map', entries, ...position }
  }

  // A name followed by `:`, `,` or `}` starts a field of an anonymous struct; a map's keys are
  // other expressions.
  private starts_record_field(): boolean {
    const [first, second] = [0, 1].map((offset) => this.tokens.peek(offset).kind)
    return first === 'identifier' && [':', ',', '}', 'line_break'].includes(second)
  }

  // `{ x: 1, y }`; a field without a value takes that of the name.
  private parse_record_literal(position: Position): Expression {
    const fields = this.elements.parse_list('}', () => {
      if (!this.starts_record_field()) {
        const token = this.tokens.peek()
        const message = 'an anonymous struct and a map cannot be mixed'
        throw new CompileError(message, token.line, token.column)
      }
      const name = this.elements.parse_identifier()
      const value: Expression = this.tokens.accept(':')
        ? this.elements.parse_expression()
        : { ...name }
      return { name, value }
    })
    return { kind: 'record', fields, ...position }
  }

  // `case` followed by an indented block of `when` arms and a final `else` arm.
  // With a subject, an arm may list several patterns, and the `else` arm may be left out (whether
  // it may is checked later).
  parse_case(position: Position): Case {
    const subject =
      this.tokens.peek().kind === 'newline' ? undefined : this.elements.parse_expression()
    this.tokens.expect('newline', 'end of line')
    this.tokens.expect('indent', "indented 'when' arms")
    const arms: CaseArm[] = []
    do {
      this.tokens.expect('when', "'when'")
      // A pattern stops before `then`, which begins the arm's value.
      const patterns = [this.elements.parse_coalesce()]
      while (subject !== undefined && this.tokens.accept(','))
        patterns.push(this.elements.parse_coalesce())
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
      const value = this.elements.parse_expression()
      this.tokens.expect_line_end()
      return [value]
    }
    if (this.tokens.peek().kind !== 'newline') {
      throw this.tokens.error_at(this.tokens.peek(), "'then' or end of line")
    }
    return this.bodies.parse_block()
  }
}

// The guard and the element of an Iter comprehension as functions of the loop variable (see
// Comprehension). The guard's tests its condition as an `if` would: `guard then true else false`.
const lazy_functions = (
  element: Expression,
  variable: Identifier,
  guard: Expression | undefined,
): Comprehension['lazy'] => {
  const function_of = (body: Expression): FunctionLiteral => ({
    kind: 'function',
    type_params: [],
    params: [{ name: { ...variable }, type: undefined }],
    return_type: undefined,
    body: [body],
    line: body.line,
    column: body.column,
  })
  if (guard === undefined) return { guard: undefined, element: function_of(element) }
  const position = { line: guard.line, column: guard.column }
  const test: Expression = {
    kind: 'conditional',
    condition: guard,
    then_value: { kind: 'boolean', value: true, ...position },
    else_value: { kind: 'boolean', value: false, ...position },
    ...position,
  }
  return { guard: function_of(test), element: function_of(element) }
}
