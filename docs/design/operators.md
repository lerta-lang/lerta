# Operator overloading

- Supported. Operators are sugar for named methods (`a + b` ≡ `a.add(b)`, `Add` interface).
- Operator interfaces **take `Rhs` and `Out` as type parameters** (the Rust trait approach): `interface Div<Rhs, Out> { div(other: Rhs): Out }`. The return type may differ from the operand types.
- The built-in `Int` satisfies the same interfaces (so `sum<T: Add<T, T>>` can be written).
- Restrictions:
  - New operators cannot be defined. Precedence is fixed.
  - `=`, `and`, `or`, `not`, `.`, `?.` cannot be overloaded (the meaning of short-circuit evaluation and access syntax cannot be changed).
  - Comparison and equality are derived from standard interfaces:

    | interface | Method | Derived operators |
    |---|---|---|
    | `Equatable` | `equals(other: Self): Bool` | `==`, `!=` |
    | `Comparable` | `compare(other: Self): Int` (negative, 0, positive) | `<`, `<=`, `>`, `>=` (requires `Equatable`) |
    | `Hashable` | `hash(): Int` | none (requires `Equatable`; the constraint on `Map` keys `Map<K: Hashable, V>`) |
  - `Stringable` (`to_string(): String`; implemented for builtin types: see [the reference](../reference/types.md#methods)): string interpolation `"#{x}"` is `x.to_string()`. Built-in types and `String` itself satisfy it. Structs and classes do not satisfy it automatically.
  - `+=` is derived automatically from `+`.
- Interfaces for construction from literals (like Swift's `ExpressibleByIntegerLiteral`) let types added later, such as BigInt, be treated almost like built-ins.
