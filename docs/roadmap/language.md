# Language

The planned syntax, control flow, types and operators. Interfaces and generics are in [objects](objects.md).

## Syntax

- **Local function literals.** A function literal held by a local `const` may:
  - have [defaults](../reference/functions.md), as a top-level function does. Its defaults may use the locals it captures, so each is computed by a closure.
  - call itself by that name, its return type written as for any recursive function. It does not capture itself, but calls its own code with its own captures. Why: capturing itself would make a cycle that is never freed.
- **Fix suggestions** in errors of a [call without parentheses](../reference/syntax.md#calls):
  - `f g x` suggests `f g(x)`.
  - A callee that is not a name with `.name`s, as `xs[i].push x`, suggests `xs[i].push(x)`.
  - An undefined name that is a word only in its place, as `default` in `default - 1`, says so.
- **Values on the next line.** An `if` or a `case` value may start on the next line, one level deeper, as it may after `=`:
  - as the argument of a call without brackets (`print`, then `case` on the next line);
  - after the `then` of a `case` arm.
  - Why: so that the [style](../reference/style.md) can always put it there.
- **Doc comments,** which `lerta lsp` shows in hover and a tool makes a reference of.

## Control flow

- The error for a range outside a `for` names every place that takes one, the `in` of a comprehension too, not only `after 'in' of a 'for'`.

### Ranges

- **A value.** A range is a value of the builtin type `Range<T>`, holding `start`, `end` and `inclusive`.
  - Unlike `Iter<T>`, it can be traversed any number of times, and stored and passed like any value, as to a query (`where(age: 20..30)`).
  - `T` is any [`Comparable`](../reference/builtins.md#equatable-comparable-and-hashable) type, as dates for a query.
- **Membership.** `r.contains(x)` tells by comparisons whether `x` is in it, so that `in` and `not in` work through [Contains](../reference/builtins.md#contains): `c in 0x20..0x7e`.
  - An `in` with a range written in it already compares in place, making no value, for numbers and `Char`s (see [the reference](../reference/syntax.md#in)); it then takes any `T`.
- **Traversal.** Only a range of an integer type is [Iterable](../reference/builtins.md#iterable), as only it has a next item.
  - Its `iter` is the compiler's. Why: no bound names the integer types, and a generic body cannot take `1` as a `T` (see [objects](objects.md#open-questions)).
  - A `for` over a range written in it counts as it does now, making no value.
- **Steps.** `by` and `reversed` after the end, with no parentheses, make a `Stride<T>` of the range rather than a `Range<T>`.
  - `0...n by 2` is `0, 2, 4, ...` below `n`.
  - `0...n reversed` is the same items in the other order, `n - 1` down to `0`, so the last item need not be worked out as with Python's `range(n - 1, -1, -1)`.
  - Both may follow: `0...10 by 3 reversed` is `9, 6, 3, 0`.
  - A step is positive.
  - A `Stride` is Iterable, with no `contains`.
  - Like `in` and `when`, `by` and `reversed` are not keywords.
  - Why a `Stride`, as Swift's `stride` makes no `Range`: a step matters only to traversal, and its type may differ from `T`, as a duration for dates; a second type parameter of `Stride` alone would give that later, so `Range<T>` stays as it is.
  - Why not a method: `0...n.reversed()` reads as `n.reversed()`.

### Iterables

- **New methods:**

  | Method | Gives |
  |---|---|
  | `flatten` of an Iterable of Iterables | A lazy `Iter` of their items |
  | `skip(n)`, `skip_while(f)` | The items after those that `take(n)` and `take_while(f)` give, for an `Iter` or a `String`, which no index by a range copies from |
  | `flat_map(f)` | The items of the Iterables that `f` gives, one after another |
  | `chunks(n)`, `windows(n)` | Arrays of `n` items in a row: each item in one chunk, or in every window that holds it |

  - `flatten` needs an extend whose type parameter appears only in the bound of another, as `T` in `extend<T, I: Iterable<T>> Iterable<I>`, which the language does not allow yet ([extend](../reference/objects.md#extend)).
- **`to_string`** of arrays of other items, as of a class with a `to_string`, and of maps, sets, tuples and anonymous structs. Now an array is `Stringable` only when the compiler can write its items ([the reference](../reference/builtins.md#stringable)).
- **Nested comprehensions.** A comprehension may have several `for`s, the later nested in the earlier: `[f(x, y) for x in xs for y in ys]`.
- **`contains` and `all` through `@any`.** `contains` of an array and `all` of an Iterable are to be written through `@any`, rather than as loops of their own, once that costs nothing. A literal given to a method generated in place is generated in place where the method calls it ([internals](../internals/iteration.md#inlined-methods)), yet, over an array of 64 `Int`s:
  - `contains` as `@any((each) -> each == item)` ran 14% more instructions: LLVM works out the result after the loop, from the index, at an extra move per item.
  - `all` as `not @any((x) -> not test(x))` ran 81% more: the literal captures `test`, which then counts as escaping (`escaping_locals`), so the function given to `all` is a closure on the heap, called through its pointer. A parameter captured only by literals that are themselves generated in place would have to count as only called.
- **`Iter<T>` in std.** `Iter<T>` is to be a generic class of `std/builtins/collections.lerta` that holds such a value and the started flag, so that the compiler no longer builds `Iter`s itself (see [internals](../internals/iteration.md#iter)).
  - It waits until a call through an interface value can become a direct one.
  - Measured: a range, a `filter` and a `map` written as classes with `has_next` and `next`, each converted to an `Iter` and consumed by a `for`, ran 4.1G instructions for 20 rounds of a million items. A lazy comprehension made and consumed in one function, which LLVM inlines whole, ran 0.25G; one made and consumed by functions of their own, 1.5G. Each item goes through a call of the itab at each step, which nothing inlines.

## Types

- **Unions of array types** (`Int[] | String[]`) or of map types, which [the reference](../reference/types.md#unions) refuses. Every array has one type in its header, whatever its items, so a union tells only one array apart by it (see [internals](../internals/representation.md#objects)). Either:
  - the arrays of such a union are held in boxes, as the numbers and `String` are; or
  - each array gets the type of its item type in its header, which the runtime's arrays, made by item kind, do not know.
- **Shared members of unions** read through the union when a member is an array, a map, a tuple or an anonymous struct: `length` of `Int[] | String`. A field that every member declares is read so now.
- **More casts and patterns:** a tuple and an anonymous struct in a cast, `x as (Int, String)?`; an array type, a tuple and an anonymous struct in the patterns of a `case`, as in `x is T`.
- **The downcast of an interface value.**
- **Not planned:** an array literal's item type as one that every item fits, rather than that of its first item that decides its own ([the reference](../reference/types.md#array-literals)). It would type `[import, statements...]`, of an `Import` and the items of a `Statement[]`, as a `Statement[]`, which a return type of `Statement` does now. The literals that need a written type are of one item to be held as a union's array, as `[conditional.then_value]` as a `Statement[]`, or of items whose types make a union of none of them, as `(ImportedName | ModuleAlias)[]`, which the rule types neither.
- **Small values unboxed.** Structs, anonymous structs and tuples of at most 16 bytes as values rather than heap objects: in registers and in the room of an item (`LertaItem`), at most the two words of an interface value.
  - Gain: `for (k, v) in m.entries()` and a `Position` of a line and a column allocate nothing. They cannot be changed, so the representation does not show in what a program does.
  - In a union, such a value is still held in a box (see [internals](../internals/representation.md#objects)).
  - Counted before trying: of the 10.9M objects that the compiler's own `dump-llvm` allocates, such values are about 0.6M, against 4.8M strings and 2.3M arrays; less than 1% of its instructions by the cost of an allocation. The benchmarks in `bench/` allocate almost none (`bench/binary_trees` a class).
  - It waits until a program shows the need, as it touches every place that takes a value for one word: the IR types, reference counting, array items, map keys, union tests, equality and hashing.

## Numeric types

- A `UInt64` literal above the largest `Int`, as `0xFFFFFFFFFFFFFFFF`.
- Conversions from `Float` to the sized integer types, which now go through `to_int()`.
- `Int` divides as `Div<Int, Int>` (see [operators](../reference/builtins.md#operators)). To divide as `Float`, convert explicitly. For an always non-negative remainder, use `x.mod(n)`.

## Operator overloading

- Interfaces for construction from literals (like Swift's `ExpressibleByIntegerLiteral`), so that types added later, such as BigInt, are treated almost like builtins. BigInt is planned too.

## Open questions

- Whether `-1.abs()` is `(-1).abs()` (the negative literal binds first) or `-(1.abs())` (as in Rust and Python). Decide when methods on literals are implemented.
- Renaming in destructuring (`{ a: x } := value`).
- Notation for an array inside an array without brackets (CoffeeScript has one).
- An index in an Iter comprehension, `(f(x, i) for x, i in xs)`.
- How an Iter gives an item in one call rather than two (`has_next` and `next`, each through a pointer to code now; see [internals](../internals/iteration.md#iter)):
  - `next` giving the item with whether there was one, as Rust's `Option` and Swift's optional. Its `{ i1, T }` in IR can be that for the Iters the compiler generates, but an Iter written in Lerta, `{ has_next, next }`, cannot write `next: () -> T?` for an `Iter<T?>`.
  - Or the end signalled as an exception, as Python's `StopIteration`, which the check after each call that Lerta has anyway would carry.
- Whether `as` also widens a value to a type it fits, as Swift's `nil as String?` or `x as Shape`, for a value in the middle of an expression. A `const` with a type annotation does it now. It would sit beside the casts that may fail, `as T?` and `as T!`, which `as T` alone is not allowed to be.
- Whether `m[k, default: d]` adds `k` to the map only where the value is written, as by `+=` or `push`, rather than also where it is only read (see [the reference](../reference/types.md#map)). A read that changes the map is a surprise: `dict.get(k, d)` and `getOrDefault` change nothing. `m[k] ? d` reads without adding now.
- Whether a `var` and a field whose type is written as an array may leave out their value, as a const may (see [the reference](../reference/syntax.md)). Now `var xs: Int[]` needs `= []`, so the one that can change is the longer to declare.
- Whether `pass` is a statement too, as it is an arm's body now (see [case](../reference/control-flow.md#case-without-a-subject)). A function or a `catch` that does nothing is written `-> return` or with `nil` now: two spellings of one thing.
