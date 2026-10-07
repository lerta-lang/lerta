import type {
  Assignment,
  Declaration,
  Expression,
  For,
  If,
  Program,
  Statement,
  While,
} from './ast.ts'
import { CompileError, CompileWarning } from './errors.ts'
import { ExpressionChecker, type CheckerLocal } from './expression_checker.ts'
import { Scopes } from './scopes.ts'
import { bool_type, format_type, int_type, type Type } from './types.ts'

// The type of every expression in a checked program.
export type Types = Map<Expression, Type>

// Warnings are found as scopes end; they are reported in source order.
const in_source_order = (warnings: CompileWarning[]): CompileWarning[] =>
  warnings.toSorted((a, b) => a.line - b.line || a.column - b.column)

export const check = (program: Program): { types: Types; warnings: CompileWarning[] } => {
  const checker = new Checker()
  try {
    checker.check_block(program)
  } catch (error) {
    if (error instanceof CompileError) error.warnings = in_source_order(checker.warnings)
    throw error
  }
  return { types: checker.types, warnings: in_source_order(checker.warnings) }
}

class Checker {
  readonly types: Types = new Map()
  readonly warnings: CompileWarning[] = []
  private readonly scopes = new Scopes<CheckerLocal>()
  private readonly expressions = new ExpressionChecker(this.types, this.scopes)
  private loop_depth = 0

  // A block is a scope; `define` declares the names that belong to it besides its statements.
  check_block(statements: Statement[], define = () => {}): void {
    this.scopes.push()
    define()
    for (const statement of statements) this.check_statement(statement)
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

  private check_while(while_statement: While): void {
    this.expressions.expect_type(while_statement.condition, bool_type)
    this.check_loop_body(while_statement.body)
  }

  private check_if(if_statement: If): void {
    this.expressions.expect_type(if_statement.condition, bool_type)
    this.check_block(if_statement.then_body)
    this.check_block(if_statement.else_body)
  }

  private check_declaration(declaration: Declaration): void {
    const type = this.expressions.type_of(declaration.value)
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
    const local = this.scopes.lookup(target.name)
    if (local === undefined || !local.mutable) {
      const reason = local === undefined ? 'is not a variable' : 'is not a var'
      throw new CompileError(`'${target.name}' ${reason}`, target.line, target.column)
    }
    // A write is not a use: the target's type is checked without reading it.
    this.types.set(target, local.type)
    if (assignment.operator !== '=' && local.type.kind !== 'Int') {
      const message = `expected Int, got ${format_type(local.type)}`
      throw new CompileError(message, target.line, target.column)
    }
    this.expressions.expect_type(assignment.value, local.type)
  }

  private warn_if_unused(local: CheckerLocal): void {
    const { name, line, column } = local.identifier
    if (local.declared && !local.used && !name.startsWith('_')) {
      this.warnings.push(new CompileWarning(`'${name}' is never used`, line, column))
    }
  }

  // Only ranges can be iterated so far.
  private check_for(for_statement: For): void {
    const { iterable, variable } = for_statement
    if (iterable.kind !== 'range') {
      throw new CompileError("expected a range after 'in'", iterable.line, iterable.column)
    }
    this.expressions.expect_type(iterable.start, int_type)
    this.expressions.expect_type(iterable.end, int_type)
    this.check_loop_body(for_statement.body, () =>
      this.define_local({
        identifier: variable,
        type: int_type,
        mutable: false,
        declared: false,
        used: false,
      }),
    )
  }

  // Shadowing a builtin is silent, so that new builtins do not affect existing code. Shadowing a
  // local name is a warning, unless the name starts with `_` to show that it is intended.
  private define_local(local: CheckerLocal): void {
    const { identifier, type } = local
    const { name, line, column } = identifier
    const definition = this.scopes.define(name, local)
    if (definition === 'redefined') {
      throw new CompileError(`'${name}' is already defined in this scope`, line, column)
    }
    if (definition === 'shadowing' && !name.startsWith('_')) {
      this.warnings.push(
        new CompileWarning(`'${name}' shadows a name in an outer scope`, line, column),
      )
    }
    this.types.set(identifier, type)
  }

  // See the rules for discarded values in docs/reference/errors.md.
  private check_expression_statement(statement: Expression): void {
    const type = this.expressions.type_of(statement)
    if (statement.kind === 'call' || type.kind === 'void') return
    if (type.kind === 'function' && statement.kind === 'identifier') {
      const message = `function value is unused; to call it, write \`${statement.name}()\``
      throw new CompileError(message, statement.line, statement.column)
    }
    throw new CompileError('value is unused', statement.line, statement.column)
  }
}
