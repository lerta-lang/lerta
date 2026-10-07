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
import type { Type } from './types.ts'

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

// A body that cannot go on past its end: it ends with `return`, `break`, `continue`, or an
// expression that never gives a value, such as `throw` or a call to `exit`.
export const ends_with_jump = (
  statements: Statement[],
  is_never: (expression: Expression) => boolean,
): boolean => {
  const last = statements.at(-1)
  if (last === undefined) return false
  if (['return', 'break', 'continue'].includes(last.kind)) return true
  return is_expression(last) && is_never(last)
}

// A view of an optional local with its type without nil, which marks the local itself as used.
// A view of a local with a narrower type, which marks the local itself as used.
export const narrowed_view = (local: CheckerLocal, type: Type): CheckerLocal => ({
  ...local,
  type,
  declared: false,
  origin: local.origin ?? local,
})
