# Language

The planned syntax, control flow, types and operators.

## Syntax

- Multi-line strings use `"""..."""`. The common leading indentation is removed, measured from the position of the closing `"""` (the Swift approach).
- For `var x: T?` the initial value may be omitted; it defaults to nil.
- Variadic parameters are `xs...`, and a call spreads an array into them as an array literal spreads it (see [spread](../reference/types.md#array)): `f(args...)`.
- A call may name the arguments of parameters that have [defaults](../reference/functions.md), after the others, and leave out any of them, not only some from the last: `build(source, optimize: true)` for `build = (source: String, output: String? = nil, optimize = false)`. How this sits with the named arguments of an anonymous struct (see [the reference](../reference/types.md#anonymous-structs)) is open.
- A function literal held by a local `const` may have [defaults](../reference/functions.md), as a top-level function does. Its defaults may use the locals it captures, so each is computed by a closure.
- A function literal held by a local `const` may call itself by that name, its return type written as for any recursive function. It does not capture itself, which would make a cycle that is never freed, but calls its own code with its own captures.
- A parameter whose default is a `Float` literal may leave out its type, as one whose default is an `Int`, `String` or `Bool` literal may ([the reference](../reference/functions.md)).
- An item inside brackets may open an indented block (a `case`, a function body).
- An error in a [call without parentheses](../reference/syntax.md#calls) suggests the fix: `f g x` suggests `f g(x)`, and a callee that is not a name with `.name`s, as `xs[i].push x`, suggests `xs[i].push(x)`. An undefined name that is a word only in its place, as `default` in `default - 1`, says so.
- An `if` or a `case` value may start on the next line, one level deeper, also as the argument of a call without brackets (`print`, then `case` on the next line) and after the `then` of a `case` arm, as it may after `=`, so that the [style](../reference/style.md) can always put it there.

## Control flow

- Narrowing a `var`.
- Narrowing a path of fields that cannot be reassigned, from a value that is narrowed now or from `@`: `if @item is A`, then `@item.a`. A `var` field of a class is not narrowed, as a `var` is not.
- A `Bool?` is not a condition, nor an operand of `and`, `or` and `not`: write `b == true` or `b != nil`. Now it holds when it is `true` ([the reference](../reference/control-flow.md)), so nil and `false` read alike.
- Code after a call to a function returning `never` (`exit`) is unreachable.
- The error for a range outside a `for` names every place that takes one, the `in` of a comprehension too, not only `after 'in' of a 'for'`.

### Ranges

- A range is a value of the builtin type `Range`, which can be traversed any number of times (unlike `Iter<T>`), stored and passed like any value, as to a query (`where(age: 20..30)`).
- `a...b` excludes its end and `a..b` includes it, as in CoffeeScript (and Ruby): `0...n` is `0` to `n - 1`, as SQL's `>= 0 AND < n`, and `20..30` is `20` to `30`, as SQL's `BETWEEN 20 AND 30`.
- `by` and `reversed` after the end are part of the range, so they need no parentheses: `0...n by 2` is `0, 2, 4, ...` below `n`, and `0...n reversed` is the same items in the other order, `n - 1` down to `0`, so the last item need not be worked out as with Python's `range(n - 1, -1, -1)`. Both may follow, `0...10 by 3 reversed` being `9, 6, 3, 0`. A step is positive. Like `in` and `when`, they are not keywords. A method could not do it: `0...n.reversed()` reads as `n.reversed()`.
- Its items are `Int`s; ranges of other types, as of dates for a query, wait for a `Comparable` interface ([operator overloading](#operator-overloading)).
- A `for` over a range written in it counts as it does now, making no value.

### Iterables

- More methods of `Array` and `Iter<T>` besides [those there are](../reference/types.md#iter).
- A comprehension may have several `for`s, the later ones nested in the earlier: `[f(x, y) for x in xs for y in ys]`.
- Later, `Iter<T>` moves to `std/builtins.lerta` as a generic class that holds such a value and the started flag, once generic classes exist, so that the compiler no longer builds `Iter`s in itself (see [internals](../internals.md#iter)) and `take` is written in Lerta. Code that uses `Iter`s does not change.

## Types

- Union members other than classes and structs, where `?` binds tighter than `|` (`Int | String?` is `Int | (String?)`). `T?` is then shorthand for `T | nil`; unions remain the general form.
- The downcast of an interface value.
- An array literal's element type is one that every item fits, rather than that of the first item that gives one ([the reference](../reference/types.md#array)): `[import, statements...]`, of an `Import` and the items of a `Statement[]`, is a `Statement[]`, as `Import` is a member of that union.
- Small anonymous structs and tuples as values rather than heap objects, in registers and in the room of an item (`LertaItem`), so that `for (k, v) in m.entries()` allocates nothing. They cannot be changed, so the representation does not show in what a program does.
- Arrays of optional `Int`, `Byte` and `Bool` values (`Int?[]`), which have no item kind yet: an item kind for `{ i1, T }`, which fits in the room of an item (`LertaItem` in `runtime/lerta.h`). A map's value stays not optional, since a missing key reads as nil.

Interfaces and generics are in [objects](objects.md).

## Numeric types

- `Int8/16/32` and `UInt16/32/64`. Arrays and maps hold each at its own size, as they hold a `Byte` in one byte (`LertaItemKind` in `runtime/lerta.h`).
- The new integer types follow the overflow rule of `Int` and `Byte` (see [the reference](../reference/types.md#int)): signed types throw and unsigned types wrap around. For the rare case of wanting signed wraparound, use a method such as `x.wrapping_add(y)`.
- Bitwise operators `&`, `|`, `^`, `<<` and `>>` on the integer types; where they sit among the [precedences](../reference/syntax.md#operators) is open.
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

## Open questions

- Whether `-1.abs()` is `(-1).abs()` (the negative literal binds first) or `-(1.abs())` (as in Rust and Python). Decide when methods on literals are implemented.
- Renaming in destructuring (`const { a: x } = value`).
- Notation for writing an array inside an array without brackets (CoffeeScript can).
- How a union holds a member that is not a heap object, as `Int` or `Bool`, or `String` if it becomes an immediate value (see [internals](../internals.md#strings)): a union value is now a pointer to an object, whose member's type the drop function in its header tells (see `emit_type_test` in `compiler/codegen/heap_object.lerta`), and nil a null pointer. A tag beside a word that holds the value or the pointer keeps `Int` unboxed; boxing it into an object with a header keeps the test as it is but allocates.
- `Binary` literals (`'...'.binary` can substitute).
- Ranges without an end or a start, `20..` and `...n`, as SQL's `>= 20` and `< n` (Rust and Swift have them).
- An index in an Iter comprehension, `(f(x, i) for x, i in xs)`.
- How an Iter gives an item in one call rather than two, `has_next` and `next`, which each item takes now through a pointer to code (see [internals](../internals.md#iter)): `next` giving the item with whether there was one, as Rust's `Option` and Swift's optional, which its `{ i1, T }` in IR can be for the Iters the compiler generates, while an Iter written in Lerta, `{ has_next, next }`, cannot write `next: () -> T?` for an `Iter<T?>`; or the end signalled as an exception, as Python's `StopIteration`, which the check after each call that Lerta has anyway would carry.
- Whether `as` also widens a value to a type that it fits, as Swift's `nil as String?` or `x as Shape` does, for a value in the middle of an expression; a `const` with a type annotation does it now. It would sit beside the casts that may fail, `as T?` and `as T!`, which `as T` alone is not allowed to be.
- Whether `?` (nil coalescing) binds tighter than comparisons, as Swift's `??` and Kotlin's `?:` do: now `ages[name] ? 0 > 18` is `ages[name] ? (0 > 18)` ([the reference](../reference/syntax.md#operators)), and goes unnoticed when both sides are `Bool`. Count the code whose meaning would change before deciding.
- Whether `Float` should hold infinities, as IEEE 754 does, which a division by zero gives (see [the reference](../reference/types.md#float)). For now, an operation that would give one throws; allowing them later breaks no program. JSON has no infinity either.
