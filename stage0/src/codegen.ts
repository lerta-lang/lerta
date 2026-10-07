import type { Token } from './lexer.ts'

// The source is not compiled yet: every program becomes an empty one.
export const generate = (_tokens: Token[]): string =>
  `define void @lerta_main() {
  ret void
}
`
