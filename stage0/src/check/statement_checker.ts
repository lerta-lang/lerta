// Checks statements and blocks, defining the locals they declare; loops are checked by the
// loop checker.
import { AssignmentChecker } from './assignment_checker.ts'
import {
  is_expression,
  type Comprehension,
  type Condition,
  type Declaration,
  type Expression,
  type FunctionLiteral,
  type Identifier,
  type Jump,
  type If,
  type Return,
  type Statement,
} from '../syntax/ast.ts'
import type { FunctionContext, SelfContext, Shared, Types } from './shared.ts'
import { ClosureChecker, type ClosureContext } from './closure_checker.ts'
import { CompileError, CompileWarning } from '../errors.ts'
import { ExpressionChecker, type CheckerLocal, type JumpChecker } from './expression_checker.ts'
import type { Functions } from './functions.ts'
import {
  ends_with_jump,
  narrowed_view,
  narrowing_of,
  type ConditionNarrowing,
} from './narrowing.ts'
import { LoopChecker, type LoopBodyChecker } from './loop_checker.ts'
import { ResultChecker } from './result_checker.ts'
import { Scopes } from '../scopes.ts'
import type { TopLevelValues } from './top_level_values.ts'
import type { Imports } from './imports.ts'
import type { ObjectTypes } from './object_types.ts'
import type { TypeResolver } from './type_names.ts'
import { format_type, never_type, void_type, type Type } from '../types.ts'
import type { BlockChecker } from './case_checker.ts'

export class StatementChecker implements BlockChecker, JumpChecker, LoopBodyChecker {
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
  private readonly expressions: ExpressionChecker
  private readonly results: ResultChecker
  private readonly loops: LoopChecker
  private readonly assignments: AssignmentChecker
  private readonly closures: ClosureChecker

  // `closure`: see ClosureChecker.
  constructor(
    shared: Shared,
    context: FunctionContext | undefined,
    self: SelfContext | undefined,
    closure?: ClosureContext,
  ) {
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
    const seen_top_level = is_top_level_code ? undefined : this.top_level
    // Outside every scope: the top-level values, for a function or a method, and imported values.
    this.scopes = new Scopes(
      (name) =>
        this.closures.captured(name) ??
        seen_top_level?.lookup(name) ??
        this.imports.value_local(name),
    )
    this.closures = new ClosureChecker(
      shared,
      this.scopes,
      closure,
      (body_context, body_closure) =>
        new StatementChecker(shared, body_context, undefined, body_closure),
    )
    this.expressions = new ExpressionChecker(shared, this.scopes, self, seen_top_level, this, this)
    this.results = new ResultChecker(this, this.expressions, context)
    this.loops = new LoopChecker(this.expressions, this)
    this.assignments = new AssignmentChecker(
      this.types,
      this.scopes,
      this.expressions,
      seen_top_level,
    )
  }

  // Each initializer sees the constructor arguments and the fields initialized before it.
  check_initializers(): void {
    const self = this.self!
    for (const field of this.objects.info(self.type).fields) {
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
  // A method's body also has `@`, the object, as a local that cannot be written in the source.
  // `holds`, a condition known to hold where the body runs, narrows the parameters it tests.
  check_function_body(literal: FunctionLiteral, params: Type[], holds?: Expression): void {
    const define_params = () => {
      if (this.self !== undefined) {
        const { line, column } = literal
        const identifier: Identifier = { kind: 'identifier', name: '@', line, column }
        const { type } = this.self
        this.scopes.define('@', { identifier, type, mutable: false, declared: false, used: true })
      }
      literal.params.forEach((param, i) =>
        this.define_local({
          identifier: param.name,
          type: params[i],
          mutable: false,
          declared: false,
          used: false,
        }),
      )
      if (holds !== undefined) this.narrow_where_holds(holds)
    }
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

  type_of_comprehension(comprehension: Comprehension, expected: Type | undefined): Type {
    return this.loops.type_of_comprehension(comprehension, expected)
  }

  type_of_function_literal(literal: FunctionLiteral, expected: Type | undefined): Type {
    return this.closures.type_of_function_literal(literal, expected)
  }

  type_of_item_function(
    literal: FunctionLiteral,
    item: Type,
    result: Type | undefined,
    holds?: Expression,
  ): Type {
    return this.closures.type_of_item_function(literal, item, result, holds)
  }

  check_jump(jump: Jump | Return): void {
    if (jump.kind === 'return') return this.results.check_return(jump)
    this.loops.check_jump(jump)
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
        return this.loops.check_for(statement)
      case 'while':
        return this.loops.check_while(statement)
      case 'if':
        return this.check_if(statement)
      case 'declaration':
        return this.check_declaration(statement)
      case 'assignment':
        return this.assignments.check_assignment(statement)
      case 'type_alias':
        return this.require_top_level(statement, 'a type can only be declared at the top level')
      case 'extern':
        return this.require_top_level(statement, 'an extern can only be declared at the top level')
      case 'extend':
        return this.require_top_level(statement, 'an extend can only be at the top level')
      case 'import':
        return this.require_top_level(statement, 'an import can only be at the top level')
      case 'type_declaration':
        return this.require_top_level(
          statement,
          'a class or struct can only be declared at the top level',
        )
      default:
        return this.check_expression_statement(statement)
    }
  }

  // A declaration of the module, which declare_names has taken in.
  private require_top_level(statement: Statement, message: string): void {
    if (this.context === undefined && this.scopes.depth === 1) return
    throw new CompileError(message, statement.line, statement.column)
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
  check_condition(condition: Condition): () => void {
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

  // Narrows, in the current scope, the local that the condition tests, where it holds.
  narrow_where_holds(condition: Expression): void {
    const narrowing = narrowing_of(condition, this.scopes, this.resolver)
    if (narrowing?.when === true) this.narrow(narrowing)
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
      used: declaration.exported,
    })
  }

  // nil alone gives no type, and void and never give no value.
  private reject_if_not_storable(type: Type, value: Expression): void {
    if (['void', 'never', 'nil'].includes(type.kind)) {
      const message = `cannot store a value of type ${format_type(type)}`
      throw new CompileError(message, value.line, value.column)
    }
  }

  private warn_if_unused(local: CheckerLocal): void {
    const { name, line, column } = local.identifier
    if (local.declared && !local.used && !name.startsWith('_')) {
      this.warnings.push(new CompileWarning(`'${name}' is never used`, line, column))
    }
  }

  // A local may shadow any name of an outer scope, a top-level name or a builtin.
  define_local(local: CheckerLocal): void {
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
    if (type.kind === 'Iter') {
      const message = 'an Iter does nothing until it is consumed'
      throw new CompileError(message, statement.line, statement.column)
    }
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
