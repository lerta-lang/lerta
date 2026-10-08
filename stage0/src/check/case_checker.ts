// Types `case` (its conditions or patterns, and the values of its arms) and `then`/`else`.
import {
  is_expression,
  type Case,
  type Comprehension,
  type Conditional,
  type Expression,
  type FunctionLiteral,
  type Statement,
} from '../syntax/ast.ts'
import { CompileError } from '../errors.ts'
import type { CheckerLocal, ExpressionChecker } from './expression_checker.ts'
import { narrowed_view, narrowing_of, type Narrowing } from './narrowing.ts'
import type { ObjectTypes } from './object_types.ts'
import type { Scopes } from '../scopes.ts'
import type { TypeResolver } from './type_names.ts'
import { format_member, format_type, same_type, type_key, unify, type Type } from '../types.ts'

const value_kinds = ['Int', 'Byte', 'Bool', 'String']

export class CaseChecker {
  private readonly expressions: ExpressionChecker
  private readonly scopes: Scopes<CheckerLocal>
  private readonly objects: ObjectTypes
  private readonly conversions: Map<Expression, Type>
  private readonly resolver: TypeResolver
  private readonly blocks: BlockChecker

  constructor(
    expressions: ExpressionChecker,
    scopes: Scopes<CheckerLocal>,
    objects: ObjectTypes,
    conversions: Map<Expression, Type>,
    resolver: TypeResolver,
    blocks: BlockChecker,
  ) {
    this.expressions = expressions
    this.scopes = scopes
    this.objects = objects
    this.conversions = conversions
    this.resolver = resolver
    this.blocks = blocks
  }

  type_of_case(case_expression: Case, expected: Type | undefined): Type {
    const arm_narrowing = this.check_patterns(case_expression)
    const branches: Branch[] = case_expression.arms.map((arm, i) => ({
      body: arm.body,
      narrowing: arm_narrowing[i],
    }))
    if (case_expression.otherwise !== undefined) {
      branches.push({ body: case_expression.otherwise, narrowing: undefined })
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
      { body: [conditional.then_value], narrowing: narrowing_when(true) },
      { body: [conditional.else_value], narrowing: narrowing_when(false) },
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
    // Each body is a block, which sees the narrowed local, if its branch narrows one.
    const type_of_body = ({ body, narrowing }: Branch, type_of_last: (value: Expression) => Type) =>
      this.blocks.type_of_block(
        body,
        () => {
          if (narrowing === undefined) return
          const { local, type } = narrowing
          this.scopes.narrow(local.identifier.name, narrowed_view(local, type))
        },
        type_of_last,
      )
    const last_of = (branch: Branch) => branch.body.at(-1)!
    if (expected !== undefined) {
      for (const branch of branches) {
        const type = type_of_body(branch, (value) => {
          this.expressions.expect_type(value, expected)
          return expected
        })
        if (type.kind === 'void') {
          const { line, column } = last_of(branch)
          throw new CompileError(`expected ${format_type(expected)}, got void`, line, column)
        }
      }
      return expected
    }
    const values = branches.map((branch) => ({
      last: last_of(branch),
      type: type_of_body(branch, (value) => this.expressions.type_of(value)),
    }))
    const valueless = values.find(({ type }) => type.kind === 'void')
    if (void_message !== undefined && valueless !== undefined) {
      throw new CompileError(void_message, valueless.last.line, valueless.last.column)
    }
    return this.unify_values(values, at, description)
  }

  // A mix of T, T? and nil gives T?, to which the values (the last statements of the bodies) are
  // converted.
  private unify_values(
    values: { last: Statement; type: Type }[],
    at: Expression,
    description: string,
  ): Type {
    let type = values[0].type
    for (const { last, type: value_type } of values) {
      const unified = unify(type, value_type)
      if (unified === undefined) {
        const types = `expected ${format_type(type)}, got ${format_type(value_type)}`
        const message = `${description} must have the same type: ${types}`
        throw new CompileError(message, last.line, last.column)
      }
      type = unified
    }
    if (type.kind === 'nil') {
      const message = `nil alone does not give the type of ${description}; write it in an annotation`
      throw new CompileError(message, at.line, at.column)
    }
    for (const { last, type: value_type } of values) {
      const is_converted = value_type.kind !== 'never' && !same_type(value_type, type)
      if (is_converted && is_expression(last)) this.conversions.set(last, type)
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
        const key = type_key(type)
        if (handled.has(key)) {
          const { line, column } = arm.patterns[i]
          const message = `${format_member(type, union)} is already handled by an earlier arm`
          throw new CompileError(message, line, column)
        }
        handled.add(key)
      }
      return types.length === 1 ? this.narrowing(case_expression.subject!, types[0]) : undefined
    })
    const missing = union.members.filter((member) => !handled.has(type_key(member)))
    if (case_expression.otherwise === undefined && missing.length > 0) {
      const missing_types = missing.map((member) => format_member(member, union)).join(', ')
      const message = `case does not handle ${missing_types}; add them or an else arm`
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

// The body of a case arm or of then/else, and the local narrowed in it, if any.
type Branch = { body: Statement[]; narrowing: Narrowing | undefined }

// Checks a block whose last statement gives its value, if it is an expression, which `type_of_last`
// types; the block is void if it ends with another statement, and never if with a jump.
export type BlockChecker = {
  type_of_block(
    body: Statement[],
    define: () => void,
    type_of_last: (value: Expression) => Type,
  ): Type
  // A function literal in an expression, whose body is checked where it is written.
  type_of_function_literal(literal: FunctionLiteral, expected: Type | undefined): Type
  // A function literal of an item (see ClosureChecker.type_of_item_function).
  type_of_item_function(literal: FunctionLiteral, item: Type, result: Type | undefined): Type
  // `[f(x) for x in xs when g(x)]`, whose element and guard see the loop variable.
  type_of_comprehension(comprehension: Comprehension, expected: Type | undefined): Type
}
