import {
  is_expression,
  type Assignment,
  type Declaration,
  type Expression,
  type For,
  type FunctionLiteral,
  type Identifier,
  type Index,
  type If,
  type Position,
  type Program,
  type Range,
  type Return,
  type Statement,
  type While,
} from './ast.ts'
import { CompileError, CompileWarning } from './errors.ts'
import { ExpressionChecker, type CheckerLocal } from './expression_checker.ts'
import { Functions, parameter_types, type FunctionEntry } from './functions.ts'
import { Scopes } from './scopes.ts'
import { resolve_type } from './type_names.ts'
import {
  bool_type,
  format_type,
  int_type,
  is_assignable,
  same_type,
  void_type,
  type Type,
} from './types.ts'

// The type of every expression in a checked program.
export type Types = Map<Expression, Type>

// Warnings are found as scopes end; they are reported in source order.
const in_source_order = (warnings: CompileWarning[]): CompileWarning[] =>
  warnings.toSorted((a, b) => a.line - b.line || a.column - b.column)

// What all the checkers of one program share.
type Shared = { types: Types; warnings: CompileWarning[]; functions: Functions }

// The function whose body is being checked: its written return type, or the one being inferred.
type FunctionContext = { annotated: Type | undefined; inferred: Type | undefined }

export const check = (program: Program): { types: Types; warnings: CompileWarning[] } => {
  const types: Types = new Map()
  const warnings: CompileWarning[] = []
  const functions: Functions = new Functions((entry) => check_function(shared, entry))
  const shared: Shared = { types, warnings, functions }
  try {
    add_top_level_functions(program, functions)
    new Checker(shared, undefined).check_block(program)
    functions.check_all()
  } catch (error) {
    if (error instanceof CompileError) error.warnings = in_source_order(warnings)
    throw error
  }
  return { types, warnings: in_source_order(warnings) }
}

const is_function_declaration = (statement: Statement): statement is Declaration =>
  statement.kind === 'declaration' && statement.value.kind === 'function'

const add_top_level_functions = (program: Program, functions: Functions): void => {
  for (const statement of program.filter(is_function_declaration)) {
    if (statement.mutable) {
      const message = 'a function must be declared with const'
      throw new CompileError(message, statement.line, statement.column)
    }
    functions.add(statement.name, statement.value as FunctionLiteral)
  }
}

const check_function = (shared: Shared, entry: FunctionEntry): void => {
  const { literal } = entry
  const params = parameter_types(literal)
  const context: FunctionContext = {
    annotated: entry.type?.kind === 'function' ? entry.type.result : undefined,
    inferred: undefined,
  }
  new Checker(shared, context).check_function_body(literal, params)
  entry.type ??= { kind: 'function', params, result: context.inferred ?? void_type }
  shared.types.set(literal, entry.type)
}

class Checker {
  private readonly types: Types
  private readonly warnings: CompileWarning[]
  private readonly functions: Functions
  private readonly context: FunctionContext | undefined
  private readonly scopes = new Scopes<CheckerLocal>()
  private readonly expressions: ExpressionChecker
  private loop_depth = 0

  constructor(shared: Shared, context: FunctionContext | undefined) {
    this.types = shared.types
    this.warnings = shared.warnings
    this.functions = shared.functions
    this.context = context
    this.expressions = new ExpressionChecker(this.types, this.scopes, this.functions)
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
  private record_result(type: Type, at: Position): void {
    const context = this.context!
    const expected = context.annotated ?? context.inferred
    if (expected === undefined) {
      context.inferred = type
      return
    }
    if (
      !(context.annotated === undefined ? same_type(type, expected) : is_assignable(type, expected))
    ) {
      const message = `expected a return value of type ${format_type(expected)}, got ${format_type(type)}`
      throw new CompileError(message, at.line, at.column)
    }
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
    this.expressions.expect_type(while_statement.condition, bool_type)
    this.check_loop_body(while_statement.body)
  }

  private check_if(if_statement: If): void {
    this.expressions.expect_type(if_statement.condition, bool_type)
    this.check_block(if_statement.then_body)
    this.check_block(if_statement.else_body)
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
    if (type.kind === 'void' || type.kind === 'function') {
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
