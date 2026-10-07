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
  type If,
  type Position,
  type Range,
  type Return,
  type Statement,
  type While,
} from './ast.ts'
import type { Conversions, FunctionContext, Shared, Types } from './checker.ts'
import { CompileError, CompileWarning } from './errors.ts'
import { ExpressionChecker, type CheckerLocal } from './expression_checker.ts'
import type { Functions } from './functions.ts'
import { ends_with_jump, narrowed_view, tested_name } from './narrowing.ts'
import { Scopes } from './scopes.ts'
import { resolve_type } from './type_names.ts'
import { format_type, int_type, is_assignable, unify, void_type, type Type } from './types.ts'

export class StatementChecker {
  private readonly types: Types
  private readonly warnings: CompileWarning[]
  private readonly functions: Functions
  private readonly conversions: Conversions
  private readonly context: FunctionContext | undefined
  private readonly scopes = new Scopes<CheckerLocal>()
  private readonly expressions: ExpressionChecker
  private loop_depth = 0

  constructor(shared: Shared, context: FunctionContext | undefined) {
    this.types = shared.types
    this.warnings = shared.warnings
    this.functions = shared.functions
    this.conversions = shared.conversions
    this.context = context
    this.expressions = new ExpressionChecker(
      this.types,
      shared.conversions,
      this.scopes,
      this.functions,
    )
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
      if (last !== undefined) this.check_last_statement(last)
    })
  }

  // A function with a result must end with its value or a `return`. This is decided by the last
  // statement alone, not by whether the end can be reached.
  private check_last_statement(statement: Statement): void {
    const context = this.context!
    let gives_value = false
    const expects_value = context.annotated !== undefined && context.annotated.kind !== 'void'
    if (is_expression(statement) && expects_value) {
      this.record_result(this.type_of_result(statement), statement)
      gives_value = true
    } else if (is_expression(statement)) {
      const type = this.expressions.type_of(statement)
      gives_value = type.kind !== 'void' && context.annotated?.kind !== 'void'
      if (gives_value) this.record_result(type, statement)
      else this.check_discarded(statement, type)
    } else {
      this.check_statement(statement)
    }
    const result = context.annotated ?? context.inferred ?? void_type
    if (result.kind !== 'void' && !gives_value && statement.kind !== 'return') {
      const message = `the function must end with its return value of type ${format_type(result)} or a return`
      throw new CompileError(message, statement.line, statement.column)
    }
  }

  // A return value must fit the written return type, or agree with the others when inferred.
  // A return value must fit the written return type. Without one, the values decide it: a mix of
  // T, T? and nil gives T?. Values are converted to the return type when the function is done.
  private record_result(type: Type, at: Expression | Return): void {
    const context = this.context!
    if (at.kind !== 'return') context.results.push({ value: at, type })
    if (context.annotated !== undefined) {
      if (is_assignable(type, context.annotated)) return
      this.reject_result(context.annotated, type, at)
    }
    if (context.inferred === undefined) {
      context.inferred = type
      return
    }
    const unified = unify(context.inferred, type)
    if (unified === undefined) this.reject_result(context.inferred, type, at)
    context.inferred = unified
  }

  private reject_result(expected: Type, type: Type, at: Position): never {
    const message = `expected a return value of type ${format_type(expected)}, got ${format_type(type)}`
    throw new CompileError(message, at.line, at.column)
  }

  private check_return(return_statement: Return): void {
    if (this.context === undefined) {
      const message = "'return' outside a function"
      throw new CompileError(message, return_statement.line, return_statement.column)
    }
    const { value } = return_statement
    const type = value === undefined ? void_type : this.type_of_result(value)
    this.record_result(type, value ?? return_statement)
  }

  // A written return type is a hint for the value's type, which can type `[]` and literals; the
  // value is then checked as a return value, for a message that says so.
  private type_of_result(value: Expression): Type {
    const annotated = this.context!.annotated
    const hint = annotated?.kind === 'void' ? undefined : annotated
    return this.expressions.type_of(value, hint)
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

  private check_statement(statement: Statement): void {
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
      case 'return':
        return this.check_return(statement)
      case 'break':
      case 'continue':
        if (this.loop_depth === 0) {
          const message = `'${statement.kind}' outside a loop`
          throw new CompileError(message, statement.line, statement.column)
        }
        return
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
    const narrowing = this.narrowing_of(condition)
    this.check_block(then_body, () => {
      define()
      if (narrowing?.when === true) this.narrow(narrowing.local)
    })
    this.check_block(else_body, () => {
      if (narrowing?.when === false) this.narrow(narrowing.local)
    })
    const is_guard = else_body.length === 0 && ends_with_jump(then_body)
    if (narrowing?.when === false && is_guard) this.narrow(narrowing.local)
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

  // The optional local a condition tests, and the value of the condition when it is not nil.
  // Only a local that cannot be reassigned is narrowed.
  private narrowing_of(condition: Condition): { local: CheckerLocal; when: boolean } | undefined {
    const tested = tested_name(condition)
    if (tested === undefined) return undefined
    const local = this.scopes.lookup(tested.name.name)
    if (local === undefined || local.mutable || local.type.kind !== 'Optional') return undefined
    return { local, when: tested.when }
  }

  private narrow(local: CheckerLocal): void {
    this.scopes.narrow(local.identifier.name, narrowed_view(local))
  }

  // A top-level function was added to `functions` before checking started.
  private check_declaration(declaration: Declaration): void {
    if (declaration.value.kind === 'function') {
      if (this.context === undefined && this.scopes.depth === 1) return
      const message = 'a function can only be declared at the top level so far'
      throw new CompileError(message, declaration.line, declaration.column)
    }
    const annotated = declaration.type === undefined ? undefined : resolve_type(declaration.type)
    if (annotated !== undefined) this.expressions.expect_type(declaration.value, annotated)
    const type = annotated ?? this.expressions.type_of(declaration.value)
    if (type.kind === 'void' || type.kind === 'function' || type.kind === 'nil') {
      const message = `cannot store a value of type ${format_type(type)}`
      throw new CompileError(message, declaration.value.line, declaration.value.column)
    }
    this.define_local({
      identifier: declaration.name,
      type,
      mutable: declaration.mutable,
      declared: true,
      used: false,
    })
  }

  // Compound assignments such as `+=` apply to Ints only.
  private check_assignment(assignment: Assignment): void {
    const { target } = assignment
    const target_type =
      target.kind === 'index' ? this.check_item_target(target) : this.check_variable_target(target)
    const is_numeric = target_type.kind === 'Int' || target_type.kind === 'UInt8'
    if (assignment.operator !== '=' && !is_numeric) {
      const message = `expected Int or UInt8, got ${format_type(target_type)}`
      throw new CompileError(message, target.line, target.column)
    }
    this.expressions.expect_type(assignment.value, target_type)
  }

  // Only array items can be replaced; a Binary is immutable.
  private check_item_target(target: Index): Type {
    const type = this.expressions.type_of(target)
    if (this.types.get(target.object)!.kind === 'Binary') {
      const message = 'a Binary cannot be changed'
      throw new CompileError(message, target.line, target.column)
    }
    return type
  }

  private check_variable_target(target: Identifier): Type {
    const local = this.scopes.lookup(target.name)
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

  // Shadowing a builtin is silent, so that new builtins do not affect existing code. Shadowing a
  // local name or a top-level function is a warning, unless the name starts with `_` to show that
  // it is intended.
  private define_local(local: CheckerLocal): void {
    const { identifier, type } = local
    const { name, line, column } = identifier
    const is_top_level = this.context === undefined && this.scopes.depth === 1
    if (is_top_level && this.functions.has(name)) {
      throw new CompileError(`'${name}' is already defined`, line, column)
    }
    const definition = this.scopes.define(name, local)
    if (definition === 'redefined') {
      throw new CompileError(`'${name}' is already defined in this scope`, line, column)
    }
    const shadowed =
      definition === 'shadowing'
        ? 'a name in an outer scope'
        : this.functions.has(name)
          ? 'a top-level function'
          : undefined
    if (shadowed !== undefined && !name.startsWith('_')) {
      this.warnings.push(new CompileWarning(`'${name}' shadows ${shadowed}`, line, column))
    }
    this.types.set(identifier, type)
  }

  private check_expression_statement(statement: Expression): void {
    this.check_discarded(statement, this.expressions.type_of(statement))
  }

  // See the rules for discarded values in docs/reference/errors.md.
  private check_discarded(statement: Expression, type: Type): void {
    if (statement.kind === 'call' || type.kind === 'void') return
    if (type.kind === 'function' && statement.kind === 'identifier') {
      const message = `function value is unused; to call it, write \`${statement.name}()\``
      throw new CompileError(message, statement.line, statement.column)
    }
    throw new CompileError('value is unused', statement.line, statement.column)
  }
}
