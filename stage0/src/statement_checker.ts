// Checks statements and blocks, defining the locals they declare.
import {
  is_expression,
  type Assignment,
  type Condition,
  type Declaration,
  type Expression,
  type For,
  type FunctionLiteral,
  type Identifier,
  type Index,
  type Jump,
  type If,
  type Range,
  type Return,
  type Statement,
  type While,
} from './ast.ts'
import type { Capture, FunctionContext, SelfContext, Shared, Types } from './checker.ts'
import { CompileError, CompileWarning } from './errors.ts'
import {
  ExpressionChecker,
  reject_captured_var,
  type CheckerLocal,
  type JumpChecker,
} from './expression_checker.ts'
import { parameter_types, type Functions } from './functions.ts'
import {
  ends_with_jump,
  narrowed_view,
  narrowing_of,
  type ConditionNarrowing,
} from './narrowing.ts'
import { finish_function_type, ResultChecker } from './result_checker.ts'
import { Scopes } from './scopes.ts'
import type { TopLevelValues } from './top_level_values.ts'
import type { Imports } from './imports.ts'
import type { ObjectTypes } from './object_types.ts'
import type { TypeResolver } from './type_names.ts'
import { format_type, int_type, never_type, void_type, type Type } from './types.ts'
import type { BlockChecker } from './case_checker.ts'

// The enclosing functions of a function literal's body: how to find their names, and the
// captures found.
type ClosureContext = {
  enclosing: (name: string) => CheckerLocal | undefined
  captures: Capture[]
}

export class StatementChecker implements BlockChecker, JumpChecker {
  private readonly types: Types
  private readonly warnings: CompileWarning[]
  private readonly functions: Functions
  private readonly context: FunctionContext | undefined
  private readonly self: SelfContext | undefined
  private readonly objects: ObjectTypes
  private readonly imports: Imports
  private readonly resolver: TypeResolver
  private readonly scopes: Scopes<CheckerLocal>
  private readonly top_level: TopLevelValues
  // Whether this checks a function or a method, which sees the top-level values.
  private readonly scopes_see_top_level: boolean
  private readonly expressions: ExpressionChecker
  private readonly results: ResultChecker
  private loop_depth = 0
  private readonly shared: Shared
  private readonly closure: ClosureContext | undefined

  // `closure` is given for the body of a function literal in an expression, which captures the
  // names it uses from around it.
  constructor(
    shared: Shared,
    context: FunctionContext | undefined,
    self: SelfContext | undefined,
    closure?: ClosureContext,
  ) {
    this.shared = shared
    this.closure = closure
    this.types = shared.types
    this.warnings = shared.warnings
    this.functions = shared.functions
    this.objects = shared.objects
    this.imports = shared.imports
    this.resolver = shared.resolver
    this.context = context
    this.self = self
    this.top_level = shared.top_level
    // A function or a method sees the top-level values; the top-level code declares them.
    const is_top_level_code = context === undefined && self === undefined
    this.scopes_see_top_level = !is_top_level_code
    // Outside every scope: the top-level values, for a function or a method, and imported values.
    this.scopes = new Scopes(
      (name) =>
        this.captured(name) ??
        (is_top_level_code ? undefined : this.top_level.lookup(name)) ??
        this.imports.value_local(name),
    )
    this.expressions = new ExpressionChecker(
      shared,
      this.scopes,
      self,
      is_top_level_code ? undefined : this.top_level,
      this,
      this,
    )
    this.results = new ResultChecker(this, this.expressions, context)
  }

  // Each initializer sees the constructor arguments and the fields initialized before it.
  check_initializers(): void {
    const self = this.self!
    for (const field of self.info.fields) {
      if (field.value === undefined) continue
      self.initializing = field
      if (field.type !== undefined) {
        this.expressions.expect_type(field.value, field.type)
        continue
      }
      const type = this.expressions.type_of(field.value)
      this.reject_if_not_storable(type, field.value)
      field.type = type
    }
    self.initializing = undefined
  }

  // The parameters are borrowed locals. The last statement gives the return value.
  check_function_body(literal: FunctionLiteral, params: Type[]): void {
    const define_params = () =>
      literal.params.forEach((param, i) =>
        this.define_local({
          identifier: param.name,
          type: params[i],
          mutable: false,
          declared: false,
          used: false,
        }),
      )
    const body = literal.body
    const last = body.at(-1)
    this.check_block(body.slice(0, -1), define_params, () => {
      if (last !== undefined) this.results.check_last_statement(last)
    })
  }

  // The top-level code. Its names may be used by the functions, which are checked later, so the
  // returned function warns about those never used once they are.
  check_top_level(program: Statement[]): () => void {
    this.scopes.push()
    for (const statement of program) this.check_statement(statement)
    const scope = this.scopes.pop()
    return () => {
      for (const local of scope.values()) this.warn_if_unused(local)
    }
  }

  // The body is checked here, where the names around it are known; those it uses from the
  // enclosing functions are its captures.
  type_of_function_literal(literal: FunctionLiteral, expected: Type | undefined): Type {
    const expected_function = expected?.kind === 'function' ? expected : undefined
    const has_untyped = literal.params.some((param) => param.type === undefined)
    const count = literal.params.length
    if (
      has_untyped &&
      expected_function !== undefined &&
      expected_function.params.length !== count
    ) {
      const message = `expected ${format_type(expected_function)}, got a function of ${count} parameter(s)`
      throw new CompileError(message, literal.line, literal.column)
    }
    const params = parameter_types(literal, this.resolver, expected_function?.params)
    const annotated =
      literal.return_type === undefined
        ? expected_function?.result
        : this.resolver.resolve(literal.return_type, true)
    const context: FunctionContext = { annotated, inferred: undefined, results: [] }
    const captures: Capture[] = []
    const enclosing = (name: string) => this.scopes.lookup_local(name) ?? this.captured(name)
    const body = new StatementChecker(this.shared, context, undefined, { enclosing, captures })
    body.check_function_body(literal, params)
    this.shared.captures.set(literal, captures)
    return finish_function_type(context, literal, params, this.shared.conversions)
  }

  // A local of an enclosing function, seen from a function literal, which captures its value; a
  // top-level value is not captured but read where it is.
  private captured(name: string): CheckerLocal | undefined {
    if (this.closure === undefined) return undefined
    const local = this.closure.enclosing(name)
    if (local === undefined || local === this.top_level.lookup(name)) return undefined
    const { captures } = this.closure
    if (!captures.some((capture) => capture.name === name))
      captures.push({ name, type: local.type })
    return {
      ...local,
      mutable: false,
      declared: false,
      origin: local.origin ?? local,
      captured: true,
    }
  }

  check_jump(jump: Jump | Return): void {
    if (jump.kind === 'return') return this.results.check_return(jump)
    if (this.loop_depth === 0) {
      throw new CompileError(`'${jump.kind}' outside a loop`, jump.line, jump.column)
    }
  }

  // A block that gives a value (see BlockChecker); its last statement is typed in its scope.
  type_of_block(
    body: Statement[],
    define: () => void,
    type_of_last: (value: Expression) => Type,
  ): Type {
    const last = body.at(-1)!
    let type: Type = void_type
    this.check_block(body.slice(0, -1), define, () => {
      if (is_expression(last)) {
        type = type_of_last(last)
        return
      }
      this.check_statement(last)
      const is_never = (expression: Expression) => this.types.get(expression)?.kind === 'never'
      if (ends_with_jump([last], is_never)) type = never_type
    })
    return type
  }

  // A block is a scope; `define` declares the names that belong to it besides its statements, and
  // `finish` checks more before the scope ends.
  check_block(statements: Statement[], define = () => {}, finish = () => {}): void {
    this.scopes.push()
    define()
    for (const statement of statements) this.check_statement(statement)
    finish()
    // A compile error stops checking for good, so the scope needs no cleanup on the way out.
    for (const local of this.scopes.pop().values()) this.warn_if_unused(local)
  }

  private check_loop_body(body: Statement[], define?: () => void): void {
    this.loop_depth++
    try {
      this.check_block(body, define)
    } finally {
      this.loop_depth--
    }
  }

  check_statement(statement: Statement): void {
    const is_top_level = this.context === undefined && this.scopes.depth === 1
    if ('exported' in statement && statement.exported && !is_top_level) {
      throw new CompileError(
        'export can only be at the top level',
        statement.line,
        statement.column,
      )
    }
    switch (statement.kind) {
      case 'for':
        return this.check_for(statement)
      case 'while':
        return this.check_while(statement)
      case 'if':
        return this.check_if(statement)
      case 'declaration':
        return this.check_declaration(statement)
      case 'assignment':
        return this.check_assignment(statement)
      case 'type_alias':
        if (this.context === undefined && this.scopes.depth === 1) return
        throw new CompileError(
          'a type can only be declared at the top level',
          statement.line,
          statement.column,
        )
      case 'import':
        if (this.context === undefined && this.scopes.depth === 1) return
        throw new CompileError(
          'an import can only be at the top level',
          statement.line,
          statement.column,
        )
      case 'type_declaration':
        if (this.context === undefined && this.scopes.depth === 1) return
        throw new CompileError(
          'a class or struct can only be declared at the top level',
          statement.line,
          statement.column,
        )
      default:
        return this.check_expression_statement(statement)
    }
  }

  private check_range(range: Range): Type {
    this.expressions.expect_type(range.start, int_type)
    this.expressions.expect_type(range.end, int_type)
    return int_type
  }

  private check_iterated_array(iterable: Expression): Type {
    const type = this.expressions.type_of(iterable)
    if (type.kind !== 'Array') {
      const message = `expected a range or an array after 'in', got ${format_type(type)}`
      throw new CompileError(message, iterable.line, iterable.column)
    }
    return type.element
  }

  private check_while(while_statement: While): void {
    const define = this.check_condition(while_statement.condition)
    this.check_loop_body(while_statement.body, define)
  }

  // An optional name tested in the condition is narrowed where it is known not to be nil: in the
  // then branch of `if x`, in the else branch of `if not x`, and after a guard such as
  // `return if x == nil`.
  private check_if(if_statement: If): void {
    const { condition, then_body, else_body } = if_statement
    const define = this.check_condition(condition)
    const narrowing = narrowing_of(condition, this.scopes, this.resolver)
    this.check_block(then_body, () => {
      define()
      if (narrowing?.when === true) this.narrow(narrowing)
    })
    this.check_block(else_body, () => {
      if (narrowing?.when === false) this.narrow(narrowing)
    })
    const is_guard =
      else_body.length === 0 &&
      ends_with_jump(then_body, (expression) => this.types.get(expression)?.kind === 'never')
    if (narrowing?.when === false && is_guard) this.narrow(narrowing)
  }

  // Returns what the condition defines in the body: the name of `const name = value`.
  private check_condition(condition: Condition): () => void {
    if (condition.kind !== 'binding') {
      this.expressions.expect_condition(condition)
      return () => {}
    }
    const inner = this.expressions.expect_optional(condition.value)
    return () =>
      this.define_local({
        identifier: condition.name,
        type: inner,
        mutable: false,
        declared: true,
        used: false,
      })
  }

  private narrow({ local, type }: ConditionNarrowing): void {
    this.scopes.narrow(local.identifier.name, narrowed_view(local, type))
  }

  // A top-level function was added to `functions` before checking started.
  private check_declaration(declaration: Declaration): void {
    const is_top_level = this.context === undefined && this.self === undefined
    if (declaration.value.kind === 'function' && is_top_level && this.scopes.depth === 1) return
    const annotated =
      declaration.type === undefined ? undefined : this.resolver.resolve(declaration.type)
    if (annotated !== undefined) this.expressions.expect_type(declaration.value, annotated)
    const type = annotated ?? this.expressions.type_of(declaration.value)
    this.reject_if_not_storable(type, declaration.value)
    this.define_local({
      identifier: declaration.name,
      type,
      mutable: declaration.mutable,
      declared: true,
      // An exported value is for other modules to use.
      used: declaration.exported === true,
    })
  }

  // nil alone gives no type, and void and never give no value.
  private reject_if_not_storable(type: Type, value: Expression): void {
    if (['void', 'never', 'nil'].includes(type.kind)) {
      const message = `cannot store a value of type ${format_type(type)}`
      throw new CompileError(message, value.line, value.column)
    }
  }

  // Compound assignments such as `+=` apply to Ints only.
  private check_assignment(assignment: Assignment): void {
    const { target } = assignment
    const target_type =
      target.kind === 'index'
        ? this.check_item_target(target, assignment.operator)
        : target.kind === 'member'
          ? this.expressions.field_target(target)
          : this.check_variable_target(target)
    const is_numeric = target_type.kind === 'Int' || target_type.kind === 'UInt8'
    if (assignment.operator !== '=' && !is_numeric) {
      const message = `expected Int or UInt8, got ${format_type(target_type)}`
      throw new CompileError(message, target.line, target.column)
    }
    this.expressions.expect_type(assignment.value, target_type)
  }

  // Array items and map values can be replaced; a Binary is immutable. A map's key may be missing,
  // so its value cannot be combined with `+=` and so on.
  private check_item_target(target: Index, operator: Assignment['operator']): Type {
    const type = this.expressions.type_of(target)
    const object_type = this.types.get(target.object)!
    if (object_type.kind === 'Map') {
      if (operator !== '=') {
        const message = `a map value cannot be updated with '${operator}'; write m[k] = (m[k] ? 0) ${operator.slice(0, -1)} x`
        throw new CompileError(message, target.line, target.column)
      }
      return object_type.value
    }
    if (object_type.kind === 'Binary') {
      const message = 'a Binary cannot be changed'
      throw new CompileError(message, target.line, target.column)
    }
    return type
  }

  private check_variable_target(target: Identifier): Type {
    const local = this.scopes.lookup(target.name)
    const pending = this.scopes_see_top_level ? this.top_level.pending_error(target) : undefined
    if (pending !== undefined) throw pending
    reject_captured_var(local, target)
    if (local === undefined || !local.mutable) {
      const reason = local === undefined ? 'is not a variable' : 'is not a var'
      throw new CompileError(`'${target.name}' ${reason}`, target.line, target.column)
    }
    // A write is not a use: the target's type is found without reading it.
    this.types.set(target, local.type)
    return local.type
  }

  private warn_if_unused(local: CheckerLocal): void {
    const { name, line, column } = local.identifier
    if (local.declared && !local.used && !name.startsWith('_')) {
      this.warnings.push(new CompileWarning(`'${name}' is never used`, line, column))
    }
  }

  // A range gives Ints; an array gives its items.
  private check_for(for_statement: For): void {
    const { iterable, variable } = for_statement
    const item_type =
      iterable.kind === 'range' ? this.check_range(iterable) : this.check_iterated_array(iterable)
    this.check_loop_body(for_statement.body, () =>
      this.define_local({
        identifier: variable,
        type: item_type,
        mutable: false,
        declared: false,
        used: false,
      }),
    )
  }

  // A local may shadow any name of an outer scope, a top-level name or a builtin.
  private define_local(local: CheckerLocal): void {
    const { identifier, type } = local
    const { name, line, column } = identifier
    const is_top_level = this.context === undefined && this.scopes.depth === 1
    const is_taken =
      this.functions.has(name) ||
      this.objects.object_type(name) ||
      this.imports.has(name) ||
      this.resolver.has_alias(name)
    if (is_top_level && is_taken) {
      throw new CompileError(`'${name}' is already defined`, line, column)
    }
    if (!this.scopes.define(name, local)) {
      throw new CompileError(`'${name}' is already defined in this scope`, line, column)
    }
    if (is_top_level) this.top_level.define(local)
    this.types.set(identifier, type)
  }

  private check_expression_statement(statement: Expression): void {
    this.check_discarded(statement, this.expressions.type_of(statement))
  }

  // See the rules for discarded values in docs/reference/errors.md.
  check_discarded(statement: Expression, type: Type): void {
    if (statement.kind === 'call' || type.kind === 'void' || type.kind === 'never') return
    // `x ? return` is a guard: its value is the reason to stop, not something to use.
    const is_guard =
      statement.kind === 'coalesce' && this.types.get(statement.fallback)?.kind === 'never'
    if (is_guard) return
    if (type.kind === 'function' && statement.kind === 'identifier') {
      const message = `function value is unused; to call it, write \`${statement.name}()\``
      throw new CompileError(message, statement.line, statement.column)
    }
    throw new CompileError('value is unused', statement.line, statement.column)
  }
}
