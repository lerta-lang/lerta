// Narrowing an optional local where a condition shows it is not nil, including after a guard `if`.
import {
  is_expression,
  type Condition,
  type Expression,
  type Identifier,
  type NamedType,
  type Statement,
} from './ast.ts'
import type { CheckerLocal } from './expression_checker.ts'
import type { Scopes } from './scopes.ts'
import type { TypeResolver } from './type_names.ts'
import type { Type } from './types.ts'

// A local, and the narrower type it has.
export type Narrowing = { local: CheckerLocal; type: Type }
// ... where the condition is `when`.
export type ConditionNarrowing = Narrowing & { when: boolean }

// `x`, `x != nil`, `not x`, `x == nil` and `x is T` test the name x: it is not nil, or is a T,
// when the condition is `when`.
export type TestedName = {
  name: Identifier
  when: boolean
  // For `x is T`, the type x has when the test holds; otherwise x is tested against nil.
  is_type: NamedType | undefined
}

export const tested_name = (condition: Condition): TestedName | undefined => {
  if (condition.kind === 'identifier') return { name: condition, when: true, is_type: undefined }
  if (condition.kind === 'is' && condition.value.kind === 'identifier') {
    return { name: condition.value, when: true, is_type: condition.type }
  }
  if (condition.kind === 'unary' && condition.operator === 'not') {
    const inner = tested_name(condition.operand)
    return inner && { ...inner, when: !inner.when }
  }
  if (condition.kind !== 'binary' || (condition.operator !== '==' && condition.operator !== '!=')) {
    return undefined
  }
  const { left, right } = condition
  const name = left.kind === 'nil' ? right : right.kind === 'nil' ? left : undefined
  if (name?.kind !== 'identifier') return undefined
  return { name, when: condition.operator === '!=', is_type: undefined }
}

// A body that cannot go on past its end: it ends with an expression that never gives a value,
// such as `return`, `break`, `continue`, `throw` or a call to `exit`, or an `if` whose branches
// both end so.
export const ends_with_jump = (
  statements: Statement[],
  is_never: (expression: Expression) => boolean,
): boolean => {
  const last = statements.at(-1)
  if (last === undefined) return false
  if (last.kind === 'if') {
    return ends_with_jump(last.then_body, is_never) && ends_with_jump(last.else_body, is_never)
  }
  return is_expression(last) && is_never(last)
}

// A view of a local with a narrower type, which marks the local itself as used.
export const narrowed_view = (local: CheckerLocal, type: Type): CheckerLocal => ({
  ...local,
  type,
  declared: false,
  origin: local.origin ?? local,
})

// The local a condition tests, and the value of the condition when it has the narrower type. Only
// a local that cannot be reassigned is narrowed.
export const narrowing_of = (
  condition: Condition,
  scopes: Scopes<CheckerLocal>,
  resolver: TypeResolver,
): ConditionNarrowing | undefined => {
  const tested = tested_name(condition)
  if (tested === undefined) return undefined
  const local = scopes.lookup(tested.name.name)
  if (local === undefined || local.mutable) return undefined
  if (tested.is_type !== undefined) {
    if (local.type.kind !== 'Union') return undefined
    return { local, when: tested.when, type: resolver.resolve(tested.is_type) }
  }
  if (local.type.kind !== 'Optional') return undefined
  return { local, when: tested.when, type: local.type.inner }
}
