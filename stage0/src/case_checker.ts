// Types `case`: its conditions or patterns, and the values of its arms.
import type { Case, Expression } from './ast.ts'
import { CompileError } from './errors.ts'
import type { CheckerLocal, ExpressionChecker } from './expression_checker.ts'
import { narrowed_view } from './narrowing.ts'
import type { ObjectTypes } from './object_types.ts'
import type { Scopes } from './scopes.ts'
import { bool_type, format_type, same_type, unify, type Type } from './types.ts'

const value_kinds = ['Int', 'UInt8', 'Bool', 'String']

export class CaseChecker {
  private readonly expressions: ExpressionChecker
  private readonly scopes: Scopes<CheckerLocal>
  private readonly objects: ObjectTypes
  private readonly conversions: Map<Expression, Type>

  constructor(
    expressions: ExpressionChecker,
    scopes: Scopes<CheckerLocal>,
    objects: ObjectTypes,
    conversions: Map<Expression, Type>,
  ) {
    this.expressions = expressions
    this.scopes = scopes
    this.objects = objects
    this.conversions = conversions
  }

  type_of_case(case_expression: Case, expected: Type | undefined): Type {
    const arm_narrowing = this.check_patterns(case_expression)
    const values = case_expression.arms.map((arm, i) => ({
      value: arm.value,
      narrowing: arm_narrowing[i],
    }))
    if (case_expression.otherwise !== undefined) {
      values.push({ value: case_expression.otherwise, narrowing: undefined })
    }
    // Each arm's value is typed with the subject narrowed to the arm's type, if it has one.
    const type_of_value = (index: number, check: (value: Expression) => Type): Type => {
      const { value, narrowing } = values[index]
      if (narrowing === undefined) return check(value)
      this.scopes.push()
      this.scopes.narrow(
        narrowing.local.identifier.name,
        narrowed_view(narrowing.local, narrowing.type),
      )
      try {
        return check(value)
      } finally {
        this.scopes.pop()
      }
    }
    if (expected !== undefined) {
      values.forEach((_, i) =>
        type_of_value(i, (value) => (this.expressions.expect_type(value, expected), expected)),
      )
      return expected
    }
    return this.unify_values(
      case_expression,
      values.map((_, i) => ({
        value: values[i].value,
        type: type_of_value(i, (value) => this.expressions.type_of(value)),
      })),
    )
  }

  // A mix of T, T? and nil gives T?, to which the arms are converted.
  private unify_values(case_expression: Case, values: { value: Expression; type: Type }[]): Type {
    let type = values[0].type
    for (const { value, type: value_type } of values) {
      const unified = unify(type, value_type)
      if (unified === undefined) {
        const types = `expected ${format_type(type)}, got ${format_type(value_type)}`
        throw new CompileError(
          `case arms must have the same type: ${types}`,
          value.line,
          value.column,
        )
      }
      type = unified
    }
    if (type.kind === 'nil') {
      const message = 'nil alone does not give the type of a case; write it in an annotation'
      throw new CompileError(message, case_expression.line, case_expression.column)
    }
    for (const { value, type: value_type } of values) {
      if (value_type.kind !== 'never' && !same_type(value_type, type))
        this.conversions.set(value, type)
    }
    return type
  }

  // Checks the conditions or patterns; returns, for each arm, how the subject is narrowed in it.
  private check_patterns(case_expression: Case): (Narrowing | undefined)[] {
    const { subject, arms } = case_expression
    if (subject === undefined) {
      for (const arm of arms) this.expressions.expect_type(arm.patterns[0], bool_type)
      return arms.map(() => undefined)
    }
    const subject_type = this.expressions.type_of(subject)
    if (subject_type.kind === 'Union')
      return this.check_type_patterns(case_expression, subject_type)
    if (!value_kinds.includes(subject_type.kind)) {
      const message = `cannot branch on a value of type ${format_type(subject_type)}`
      throw new CompileError(message, subject.line, subject.column)
    }
    for (const arm of arms) {
      for (const pattern of arm.patterns) this.expressions.expect_type(pattern, subject_type)
    }
    if (case_expression.otherwise === undefined) {
      const message = 'a case on values needs an else arm'
      throw new CompileError(message, case_expression.line, case_expression.column)
    }
    return arms.map(() => undefined)
  }

  // Each pattern names a type of the union; without an else arm, every type must be handled. An
  // arm with one type narrows a subject that is a local that cannot be reassigned.
  private check_type_patterns(
    case_expression: Case,
    union: Extract<Type, { kind: 'Union' }>,
  ): (Narrowing | undefined)[] {
    const handled = new Set<string>()
    const arm_narrowing = case_expression.arms.map((arm) => {
      const types = arm.patterns.map((pattern) => this.type_pattern(pattern, union))
      for (const [i, type] of types.entries()) {
        const name = format_type(type)
        if (handled.has(name)) {
          const { line, column } = arm.patterns[i]
          throw new CompileError(`${name} is already handled by an earlier arm`, line, column)
        }
        handled.add(name)
      }
      return types.length === 1 ? this.narrowing(case_expression.subject!, types[0]) : undefined
    })
    const missing = union.members.filter((member) => !handled.has(format_type(member)))
    if (case_expression.otherwise === undefined && missing.length > 0) {
      const message = `case does not handle ${missing.map(format_type).join(', ')}; add them or an else arm`
      throw new CompileError(message, case_expression.line, case_expression.column)
    }
    return arm_narrowing
  }

  // The pattern's type, recorded on the pattern for codegen.
  private type_pattern(pattern: Expression, union: Extract<Type, { kind: 'Union' }>): Type {
    const type = pattern.kind === 'identifier' ? this.objects.object_type(pattern.name) : undefined
    if (type === undefined || !union.members.some((member) => same_type(member, type))) {
      const message = `expected one of the types ${format_type(union)}`
      throw new CompileError(message, pattern.line, pattern.column)
    }
    this.expressions.record_type(pattern, type)
    return type
  }

  private narrowing(subject: Expression, type: Type): Narrowing | undefined {
    if (subject.kind !== 'identifier') return undefined
    const local = this.scopes.lookup(subject.name)
    if (local === undefined || local.mutable) return undefined
    return { local, type }
  }
}

type Narrowing = { local: CheckerLocal; type: Type }
