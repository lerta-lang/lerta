// The source is not compiled yet: every program becomes an empty one.
export const generate = (_source: string): string =>
  `define void @lerta_main() {
  ret void
}
`
