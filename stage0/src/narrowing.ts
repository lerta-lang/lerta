// Narrowing an optional local where a condition shows it is not nil, including after a guard `if`.
import type { Condition, Identifier, Statement } from './ast.ts'
import type { CheckerLocal } from './expression_checker.ts'

// `x`, `x != nil`, `not x` and `x == nil` test the name x: it is not nil when the condition is
// `when`.
export const tested_name = (
  condition: Condition,
): { name: Identifier; when: boolean } | undefined => {
  if (condition.kind === 'identifier') return { name: condition, when: true }
  if (condition.kind === 'unary' && condition.operator === 'not') {
    const inner = tested_name(condition.operand)
    return inner && { name: inner.name, when: !inner.when }
  }
  if (condition.kind !== 'binary' || (condition.operator !== '==' && condition.operator !== '!=')) {
    return undefined
  }
  const { left, right } = condition
  const name = left.kind === 'nil' ? right : right.kind === 'nil' ? left : undefined
  if (name?.kind !== 'identifier') return undefined
  return { name, when: condition.operator === '!=' }
}

export const ends_with_jump = (statements: Statement[]): boolean => {
  const last = statements.at(-1)
  return last?.kind === 'return' || last?.kind === 'break' || last?.kind === 'continue'
}

// A view of an optional local with its type without nil, which marks the local itself as used.
export const narrowed_view = (local: CheckerLocal): CheckerLocal => {
  if (local.type.kind !== 'Optional') throw new Error('only an optional local is narrowed')
  return { ...local, type: local.type.inner, declared: false, origin: local.origin ?? local }
}
