// Types `case` (its conditions or patterns, and the values of its arms) and `then`/`else`.
import type { Case, Conditional, Expression } from './ast.ts'
import { CompileError } from './errors.ts'
import type { CheckerLocal, ExpressionChecker } from './expression_checker.ts'
import { narrowed_view, narrowing_of, type Narrowing } from './narrowing.ts'
import type { ObjectTypes } from './object_types.ts'
import type { Scopes } from './scopes.ts'
import type { TypeResolver } from './type_names.ts'
import { format_type, same_type, unify, type Type } from './types.ts'

const value_kinds = ['Int', 'UInt8', 'Bool', 'String']

export class CaseChecker {
  private readonly expressions: ExpressionChecker
  private readonly scopes: Scopes<CheckerLocal>
  private readonly objects: ObjectTypes
  private readonly conversions: Map<Expression, Type>
  private readonly resolver: TypeResolver

  constructor(
    expressions: ExpressionChecker,
    scopes: Scopes<CheckerLocal>,
    objects: ObjectTypes,
    conversions: Map<Expression, Type>,
    resolver: TypeResolver,
  ) {
    this.expressions = expressions
    this.scopes = scopes
    this.objects = objects
    this.conversions = conversions
    this.resolver = resolver
  }

  type_of_case(case_expression: Case, expected: Type | undefined): Type {
    const arm_narrowing = this.check_patterns(case_expression)
    const branches: Branch[] = case_expression.arms.map((arm, i) => ({
      value: arm.value,
      narrowing: arm_narrowing[i],
    }))
    if (case_expression.otherwise !== undefined) {
      branches.push({ value: case_expression.otherwise, narrowing: undefined })
    }
    return this.type_of_branches(branches, expected, case_expression, 'case arms')
  }

  // A condition of a case without a subject is one of an `if`, which narrows a local in its arm.
  private check_condition(condition: Expression): Narrowing | undefined {
    this.expressions.expect_condition(condition)
    const narrowing = narrowing_of(condition, this.scopes, this.resolver)
    return narrowing?.when === true ? narrowing : undefined
  }

  // The condition narrows a local as `if` does: in the value for when it holds, or the other.
  type_of_conditional(conditional: Conditional, expected: Type | undefined): Type {
    this.expressions.expect_condition(conditional.condition)
    const narrowing = narrowing_of(conditional.condition, this.scopes, this.resolver)
    const narrowing_when = (when: boolean) => (narrowing?.when === when ? narrowing : undefined)
    const branches = [
      { value: conditional.then_value, narrowing: narrowing_when(true) },
      { value: conditional.else_value, narrowing: narrowing_when(false) },
    ]
    const description = 'the values of then and else'
    const void_message = 'then and else must give values; to run statements, write an if'
    return this.type_of_branches(branches, expected, conditional, description, void_message)
  }

  // The type of the values the branches give: the expected type, or else one that they unify to
  // (see unify), to which they are converted. Each value is typed with a local narrowed, if its
  // branch narrows one.
  private type_of_branches(
    branches: Branch[],
    expected: Type | undefined,
    at: Expression,
    description: string,
    // The error for a value that is void, which the branches may give unless it is set.
    void_message?: string,
  ): Type {
    const type_of_value = ({ value, narrowing }: Branch, check: (value: Expression) => Type) => {
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
      for (const branch of branches) {
        type_of_value(branch, (value) => (this.expressions.expect_type(value, expected), expected))
      }
      return expected
    }
    const values = branches.map((branch) => ({
      value: branch.value,
      type: type_of_value(branch, (value) => this.expressions.type_of(value)),
    }))
    const valueless = values.find(({ type }) => type.kind === 'void')
    if (void_message !== undefined && valueless !== undefined) {
      throw new CompileError(void_message, valueless.value.line, valueless.value.column)
    }
    return this.unify_values(values, at, description)
  }

  // A mix of T, T? and nil gives T?, to which the values are converted.
  private unify_values(
    values: { value: Expression; type: Type }[],
    at: Expression,
    description: string,
  ): Type {
    let type = values[0].type
    for (const { value, type: value_type } of values) {
      const unified = unify(type, value_type)
      if (unified === undefined) {
        const types = `expected ${format_type(type)}, got ${format_type(value_type)}`
        const message = `${description} must have the same type: ${types}`
        throw new CompileError(message, value.line, value.column)
      }
      type = unified
    }
    if (type.kind === 'nil') {
      const message = `nil alone does not give the type of ${description}; write it in an annotation`
      throw new CompileError(message, at.line, at.column)
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
    if (subject === undefined) return arms.map((arm) => this.check_condition(arm.patterns[0]))
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

// A value of a case or a then/else, and the local narrowed where it is evaluated, if any.
type Branch = { value: Expression; narrowing: Narrowing | undefined }
