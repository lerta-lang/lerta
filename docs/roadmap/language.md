# Language

The planned syntax, control flow, types, operators and strings.

## Syntax

- Multi-line strings use `"""..."""`. The common leading indentation is removed, measured from the position of the closing `"""` (the Swift approach).
- For `var x: T?` the initial value may be omitted; it defaults to nil.
- Variadic parameters are `xs...`. A parameter may have a default value, `(x: Int, y = 0)`, which a call may leave out; a constructor argument has one by `default` (see [objects](../reference/objects.md)).
- An item inside brackets may open an indented block (a `case`, a function body).

## Control flow

- Narrowing a `var`.
- Code after a call to a function returning `never` (`exit`) is unreachable.
- Because `void` is not a type, generics cannot treat "returns a value / returns nothing" uniformly, and the standard library splits such functions, like `map` / `for_each`.

### Ranges

- A range is a value of the builtin type `Range`, which can be traversed any number of times (unlike `Iter<T>`).

### Iterables

- More methods of `Array` and `Iter<T>` besides `map`/`filter`/`take`/`any`/`all`/`find`.
- Later, `Iter<T>` moves to `std/builtins.lerta` as a generic class that holds such a value and the started flag, once generic classes exist, so that the compiler no longer builds `Iter`s in itself (see [internals](../internals.md#lazy-iterators)) and `take` is written in Lerta. Code that uses `Iter`s does not change.

## Types

- Union members other than classes and structs, where `?` binds tighter than `|` (`Int | String?` is `Int | (String?)`). `T?` is then shorthand for `T | nil`; unions remain the general form.
- The downcast of an interface value.

Interfaces and generics are in [objects](objects.md).

## Numeric types

- `Int8/16/32`, `UInt16/32/64` and `Float`. Float literals are only lexed and kept as strings for now. Arrays and maps hold each at its own size, as they hold a `Byte` in one byte (`LertaItemKind` in `runtime/lerta.h`).
- The new integer types follow the overflow rule of `Int` and `Byte` (see [the reference](../reference/types.md#int)): signed types throw and unsigned types wrap around. For the rare case of wanting signed wraparound, use a method such as `x.wrapping_add(y)`.
- `Int: Div<Int, Int>` (see [operator overloading](#operator-overloading)). To divide as `Float`, convert explicitly. For an always non-negative remainder, use `x.mod(n)`.

## Operator overloading

- Supported. Operators are sugar for named methods (`a + b` ≡ `a.add(b)`, `Add` interface).
- Operator interfaces **take `Rhs` and `Out` as type parameters** (the Rust trait approach): `interface Div<Rhs, Out> { div(other: Rhs): Out }`. The return type may differ from the operand types.
- The builtin `Int` satisfies the same interfaces (so `sum<T: Add<T, T>>` can be written).
- Restrictions:
  - New operators cannot be defined. Precedence is fixed.
  - `=`, `and`, `or`, `not`, `.`, `?.` cannot be overloaded (the meaning of short-circuit evaluation and access syntax cannot be changed).
  - Comparison and equality are derived from standard interfaces:

    | interface | Method | Derived operators |
    |---|---|---|
    | `Equatable` | `equals(other: Self): Bool` | `==`, `!=` |
    | `Comparable` | `compare(other: Self): Int` (negative, 0, positive) | `<`, `<=`, `>`, `>=` (requires `Equatable`) |
    | `Hashable` | `hash(): Int` | none (requires `Equatable`; the constraint on `Map` keys `Map<K: Hashable, V>`) |
  - `+=` is derived automatically from `+`.
- Interfaces for construction from literals (like Swift's `ExpressibleByIntegerLiteral`) let types added later, such as BigInt, be treated almost like builtins. BigInt is planned too.

## Strings

- A separate iterator for graphemes, besides the code points that a `String` gives (see [the reference](../reference/types.md#string)).
- The code points are `UInt32` values instead of `Int`s once that type exists (see [numeric types](#numeric-types)).
- Slicing uses a separate type `StringSlice`, as in Swift. Converting to `String` is an explicit copy.
- Ropes, so that `+` is O(1).
- Small strings as immediate values.
- For I/O, sockets and FFI, `void*` is `Binary` and `char*` is `String`. Encoding conversions are provided as functions between `Binary` and `String`.

### Regular expressions

- Literals are **syntax-checked at compile time**.
- Dynamic patterns are compiled at run time.

## Open questions

- Whether `-1.abs()` is `(-1).abs()` (the negative literal binds first) or `-(1.abs())` (as in Rust and Python). Decide when methods on literals are implemented.
- Renaming in destructuring (`const { a: x } = value`).
- Notation for writing an array inside an array without brackets (CoffeeScript can).
- Whether to have a range that includes its end (`..`), besides `...`. A one-character difference that flips the meaning is easy to get wrong, and CoffeeScript and Rust give `..` opposite meanings.
- Whether the `else` arm of a `case` over a union narrows the subject to the members that no `when` arm names.
- `Binary` literals (`'...'.binary` can substitute).
- Semantics of the regular expression engine (JS/PCRE-style backtracking vs RE2-style linear time).
