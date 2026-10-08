// Checks assignments: to a name, to an indexed item and to a field.
import type { Assignment, Identifier, Index } from '../syntax/ast.ts'
import { CompileError } from '../errors.ts'
import type { CheckerLocal, ExpressionChecker } from './expression_checker.ts'
import type { Scopes } from '../scopes.ts'
import type { Types } from './shared.ts'
import type { TopLevelValues } from './top_level_values.ts'
import { format_type, type Type } from '../types.ts'

export class AssignmentChecker {
  private readonly types: Types
  private readonly scopes: Scopes<CheckerLocal>
  private readonly expressions: ExpressionChecker
  // The top-level values, for a function or a method, which sees them.
  private readonly top_level: TopLevelValues | undefined

  constructor(
    types: Types,
    scopes: Scopes<CheckerLocal>,
    expressions: ExpressionChecker,
    top_level: TopLevelValues | undefined,
  ) {
    this.types = types
    this.scopes = scopes
    this.expressions = expressions
    this.top_level = top_level
  }

  // Compound assignments such as `+=` apply to Ints only.
  check_assignment(assignment: Assignment): void {
    const { target } = assignment
    const target_type =
      target.kind === 'index'
        ? this.check_item_target(target, assignment.operator)
        : target.kind === 'member'
          ? this.expressions.field_target(target)
          : this.check_variable_target(target)
    const is_numeric = target_type.kind === 'Int' || target_type.kind === 'Byte'
    if (assignment.operator !== '=' && !is_numeric) {
      const message = `expected Int or Byte, got ${format_type(target_type)}`
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
    const pending = this.top_level?.pending_error(target)
    if (pending !== undefined) throw pending
    if (local === undefined || !local.mutable) {
      const reason = local === undefined ? 'is not a variable' : 'is not a var'
      throw new CompileError(`'${target.name}' ${reason}`, target.line, target.column)
    }
    // A write is not a use: the target's type is found without reading it.
    this.types.set(target, local.type)
    return local.type
  }
}
