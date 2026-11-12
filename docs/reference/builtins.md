# Builtins

- Builtins need no import. They are what the module `'std:builtins'` exports.
- Most are written in Lerta, in the files of `std/builtins/`, by topic, which `std/builtins.lerta` exports from (see [exports](modules.md#exports)).
- Every other module imports it as `import 'std:builtins'` (see [modules](modules.md)).
- A module's own names shadow the builtins, as a module's own `Stringable` shadows the interface.

## Functions

| Function | |
|---|---|
| `panic(message: String): never` | Stops the program at once (see [panics](errors.md#panics)). |
| `assert condition` | Throws an `AssertionError` unless the condition holds (see [assert](errors.md#assert)). |
| `dbg(x)` | Writes `x` to stderr, where the call is and its code, and gives `x` (below). |
| `print<T: Stringable>(x: T)` | Writes `x.to_string()` and a newline to stdout. |
| `print_error<T: Stringable>(x: T)` | Likewise, to stderr. |
| `print_trace(error: Error)` | Writes the message of a caught exception, and its trace, to stderr (below). |
| `min<T: Comparable>(a: T, b: T): T` | The lesser argument by [compare](#equatable-comparable-and-hashable), the first of equal ones: `min(3, 1)` is `1`. |
| `max<T: Comparable>(a: T, b: T): T` | The greater argument, likewise. |

`Error`, the interface of what `throw` takes, and the runtime's error types are builtins too (see [exceptions](errors.md#exceptions)).

### print and print_error

- Each writes at once, unbuffered, so that what it prints is out even if a long computation follows.
- It writes after what the buffer of `stdout` and `stderr` of [std:io](std.md#stdio) holds, once a write out of it in flight is done, so that the output keeps its order.
- A failed write to stdout is reported by the exit code, as [std:io](std.md#stdio) states.

### print_trace

```lerta
try
  run_job()
catch error
  print_trace error
```

- It writes the message of `error`, a value that satisfies `Error`, and its trace, as an uncaught exception does (see [exceptions](errors.md#exceptions)), to stderr in order with the buffered output, as `print_error` does.
- The runtime keeps the trace of only the exception thrown last, while its object lives. So the message is written alone once another exception has been thrown since, as in a `try` inside the `catch`, for an error that was never thrown, and in a program built with `--no-trace` (see [the compiler](compiler.md#--no-trace)).
- It can only be called, not used as a value.

### dbg

```lerta
n := dbg(xs.length) + 1
```

- It writes a line to stderr, `scores.lerta:4:6: dbg(xs.length) = 3`: where the call is, its code as written, through its `)`, and the [literal](#literal) of `x`, as [`assert`](errors.md#assert) gives an operand's; `<T>` for a value of a type `T` that has no `to_literal`, as `<Counter[]>` for an array of objects of a class, or a map or set of them; `nil` or the literal of what it holds for an optional value.
- It gives `x`, which it evaluates once, typed as it is where the call's value is expected: `small: Int8 = dbg(3)`. A value of type `nil`, `void` or `never` is an error.
- It writes as `print_error` does, which a name of the program's own does not hide.
- It can only be called, not used as a value.

### min and max

- `T` is that of the arguments, which [infer it](functions.md#generic-functions) as for any generic function: `min(1.0, 2)` compares `Float`s, while `min(n, 2.5)` with an `Int` `n` is an error.
- More values are compared by an Iterable's `min` and `max` (see [Iterable](#iterable)): `[a, b, c].min()`.
  - Why two parameters rather than a variadic one: two values alone take no array, which a variadic parameter would make at each call.

## INT_MIN and INT_MAX

The least and the greatest [Int](types.md#int): `-9223372036854775808` and `9223372036854775807`.

## Stringable

- An [interface](objects.md#interfaces) with one member, `to_string: () -> String`. [String interpolation](syntax.md) goes through it.
- `String`, `Int`, the sized integers, `Float`, `Float32`, `Byte`, `Char`, `Bool` and enums satisfy it.
- So does any type that declares `to_string`, as a method or a field that holds a function, or gets it from an extend in effect. A `to_string` with parameters or another result does not.
- A `Bool` gives `true` or `false`, and a `Byte` a number.
- An array, a map, a set, a tuple, an anonymous struct or a struct of [Literal](#literal) parts satisfies it too, giving its literal: `[1, 2]`, `{ 'a': Point(x: 1) }`.
- An optional value does not, so that a `nil` never reaches a text unseen: `print x` and `"#{x}"` of an `Int?` are errors, which suggest `x ? default` or [`dbg(x)`](#dbg).
- Nor does a class without a `to_string`: its objects are no values that a literal writes.

### Collections

- The `to_string` and `to_literal` of an array, a map and a set come from extends of std, which no other extend can declare again. A type whose collections should read otherwise gives its items a `to_literal` of their own, as a class must for its objects to be written in them.

## Literal

- An interface with one member, `to_literal: () -> String`: the text of the literal that gives the value, as the text of an array writes its items.
- Any type that declares `to_literal` satisfies it, as for `Stringable`, with a text that writes its value as the program would.
- An optional, a struct, a tuple and an anonymous struct satisfy it by their parts, when all of them are `Literal`, unless the type declares a `to_literal` of its own, or gets one from an extend. A struct, a tuple or an anonymous struct that gets it so gets a `to_string` too, giving the same text, unless it has its own; an optional does not (see [Stringable](#stringable)), and its `to_literal` is called only through a bound or an interface value, as `x.to_literal()` of an optional `x` reads as a call on what it holds.

| Value | Literal |
|---|---|
| `String` | In single quotes if it has no `'` and no control character. Otherwise in double quotes, with `\\`, `\"`, `\#`, `\n`, `\t`, `\r` and `\0` escaped and the other control characters as `\u{7F}`. |
| `Char` | That of the `String` of it. |
| enum value | Its member as declared: its name, or the literal of its text. |
| numbers, `Bool` | Their `to_string()`, but an infinity (below). |
| infinity | `INFINITY` or `-INFINITY`; `INFINITY.to_float32()` for a `Float32`. It names std:math's `INFINITY`, so that a program reads it back where it imports it. |
| array | `[1, 2]`. |
| map | `{ 'a': 1, 'b': 2 }`, in the order of its entries; `{}` when empty, which a program reads as an empty anonymous struct, as no literal writes an empty map. |
| set | `Set([1, 2])`, in the order of its items; `Set()` when empty. |
| optional value | `nil`, or the literal of what it holds. |
| tuple | `(1, 'a')`. |
| anonymous struct | `{ name: 'b', x: 1 }`, its fields in the order of their names, which its type has; `{}` when it has none. |
| struct | `Point(x: 1, y: 2)`: its name, without type arguments, and every field in order, computed ones too, so that a program does not read it back where it has one. |

## Iterable

- `Iterable<T>` is an [interface](objects.md#interfaces) with one member, `iter: () -> Iter<T>`. `for` and comprehensions go through it (see [control flow](control-flow.md#for-and-ranges)).
- Arrays, `String`s, `Binary` values, sets and `Iter`s satisfy it; an `Iter`'s `iter()` gives itself. So does any type that has such an `iter`.
- Extends of it give every Iterable the methods below, which work as those of [Iter](types.md#iter) do.
- So a type that satisfies it cannot have a member of one of these names, nor an extend give it one, as `count` (see [extend](objects.md#extend)).

| Method | For |
|---|---|
| `map<U>(f: (T) -> U): Iter<U>` | any `T` |
| `filter(keep: (T) -> Bool): Iter<T>` | |
| `take(n: Int): Iter<T>` | |
| `take_while(keep: (T) -> Bool): Iter<T>` | |
| `zip<U>(other: Iterable<U>): Iter<(T, U)>` | |
| `any(test: (T) -> Bool): Bool` | |
| `all(test: (T) -> Bool): Bool` | |
| `find(test: (T) -> Bool): T?` | |
| `find_index(test: (T) -> Bool): Int?` | |
| `find_map<U>(f: (T) -> U?): U?` | |
| `fold<A>(initial: A, combine: (A, T) -> A): A` | |
| `count(): Int` | |
| `min_by<K: Comparable>(key: (T) -> K): T?` | |
| `max_by<K: Comparable>(key: (T) -> K): T?` | |
| `to_array(): T[]` | |
| `min(): T?`, `max(): T?` | `T` [Comparable](#equatable-comparable-and-hashable) |
| `sum(zero: T = 0): T` | `T` [Add<T, T>](#operators) |

## Contains

- `Contains<T>` is an [interface](objects.md#interfaces) with one member, `contains: (T) -> Bool`, which `x in xs` calls (see [operators](syntax.md#in)).
- Arrays satisfy it by their items, sets by theirs, maps by their keys and `String`s by their parts.
- So does any type that has such a `contains`, a method or a field that holds a function.
- A `String`'s `contains`, and so `in`, also takes a `Char`, as the `String` of it, though a `String` satisfies `Contains<String>` alone.

## Equatable, Comparable and Hashable

[Interfaces](objects.md#interfaces) for bounds such as `<T: Comparable>`:

| Interface | Members |
|---|---|
| `Equatable` | `equals: (Self) -> Bool` |
| `Comparable` | `compare: (Self) -> Ordering` |
| `Hashable` | `equals: (Self) -> Bool`, `hash: () -> Int` |

- The enum `Ordering`, a builtin too, has the members `LESS`, `EQUAL` and `GREATER`.
- Every type that `==` compares has `equals`, which compares as `==` does. So it satisfies `Equatable`.
- Every type that can be a [map key](types.md#map) has `hash`, which equal values share. So it satisfies `Hashable`.
- These are builtin, unless a class or struct declares [its own](objects.md#equality-and-order). One that declares `compare` has a builtin `equals` by it.
- The builtin `hash` of a `String` or a `Binary`, or of a value that holds one, differs from one run of the program to the next.
- The numbers, `Char` and `String` have a `compare`, and so satisfy `Comparable`, as does a class or struct that declares its own. `<` and the like order by it.

## Operators

[Interfaces](objects.md#interfaces) for bounds such as `<T: Add<T, T>>`, of the methods that the arithmetic and bitwise operators call (see [operators](objects.md#operators)):

| Interface | Member | Operator |
|---|---|---|
| `Add<Rhs, Out>` | `add: (Rhs) -> Out` | `+` |
| `Sub<Rhs, Out>` | `sub: (Rhs) -> Out` | `-` |
| `Mul<Rhs, Out>` | `mul: (Rhs) -> Out` | `*` |
| `Div<Rhs, Out>` | `div: (Rhs) -> Out` | `/` |
| `Rem<Rhs, Out>` | `rem: (Rhs) -> Out` | `%` |
| `BitAnd<Rhs, Out>` | `bit_and: (Rhs) -> Out` | `&` |
| `BitOr<Rhs, Out>` | `bit_or: (Rhs) -> Out` | `\|` |
| `BitXor<Rhs, Out>` | `bit_xor: (Rhs) -> Out` | `^` |
| `Shl<Rhs, Out>` | `shl: (Rhs) -> Out` | `<<` |
| `Shr<Rhs, Out>` | `shr: (Rhs) -> Out` | `>>` |
| `Neg<Out>` | `neg: () -> Out` | prefix `-` |

- The numbers have the methods of the operators that apply to them. They apply the operators, throwing as they do: `3.add(4)` is 7.
- `String` and `Binary` have `add`. So `<T: Add<T, T>>` takes an `Int` or a `String` as well as a type that declares `add`.

## Methods of the builtin types

The signatures of the methods of the builtin types, by type. What each does is in the type's section of [types](types.md); how each is written is in [internals](../internals/representation.md#builtins).

- Every type here that `==` compares has `equals(other: Self): Bool`, and every one that can be a map key `hash(): Int` (see [Equatable and Hashable](#equatable-comparable-and-hashable)); the lists leave them out.
- Any [Iterable](#iterable) also has the methods that Iterable gives.

### Integers

[Int](types.md#int), [Byte](types.md#byte) and the [sized integers](types.md#sized-integers). `N` is the receiver's type.

- `compare(other: N): Ordering`
- `add`, `sub`, `mul`, `div`, `rem`, `bit_and`, `bit_or`, `bit_xor`, `shl`, `shr`: `(other: N): N`; `neg(): N` of the signed ones
- `wrapping_add(other: N): N`, `wrapping_sub(other: N): N`, `wrapping_mul(other: N): N`
- `to_string(): String`, `to_literal(): String`
- `to_float(): Float`
- `to_int()`, `to_byte()`, `to_int8()`, `to_int16()`, `to_int32()`, `to_uint16()`, `to_uint32()`, `to_uint64()`: of that type, optional unless every value fits
- `to_char(): Char?`; `Char` for a `Byte`
- `Int` and `UInt64`: `to_hex(width: Int = 0): String`
- `Int` only: `to_bits(): UInt64`
- `Byte` only: `is_digit(): Bool`, `is_letter(): Bool`, `is_space(): Bool`, `is_utf8_continuation(): Bool`, `hex_value(): Int?`

### Char

[Char](types.md#char).

- `compare(other: Char): Ordering`
- `add(count: Int): Char`, `sub(count: Int): Char`
- `to_string(): String`, `to_literal(): String`
- `to_int(): Int`
- `is_digit(): Bool`, `is_letter(): Bool`, `is_space(): Bool`, `is_lower(): Bool`, `is_upper(): Bool`
- `to_upper(): Char`, `to_lower(): Char`, `hex_value(): Int?`

### Float and Float32

[Float](types.md#float) and [Float32](types.md#float32). `F` is the receiver's type.

- `compare(other: F): Ordering`
- `add`, `sub`, `mul`, `div`: `(other: F): F`; `neg(): F`
- `to_string(): String`, `to_literal(): String`
- `Float` only: `to_int(): Int?`, `to_fixed(digits: Int): String`, `to_float32(): Float32`
- `Float32` only: `to_float(): Float`

### Bool

[Bool](types.md#bool).

- `to_string(): String`, `to_literal(): String`

### String

[String](types.md#string). `s.binary: Binary` is a property.

- `compare(other: String): Ordering`
- `add(other: String): String`
- `to_string(): String`, `to_literal(): String`
- `iter(): Iter<Char>`
- `is_empty(): Bool`
- `contains(part: String): Bool`, which takes a `Char` too
- `starts_with(prefix: String): Bool`, `ends_with(suffix: String): Bool`
- `without_prefix(prefix: String): String?`, `without_suffix(suffix: String): String?`
- `is_digits(): Bool`
- `parse_int(): Int?`, `parse_float(): Float?`
- `split(separator: String): String[]`, `split_once(separator: String): (String, String)?`, `split_whitespace(): String[]`, `lines(): String[]`
- `replace(part: String, by: String): String`
- `trim(): String`, `trim_start(): String`, `trim_end(): String`
- `repeat(count: Int): String`
- `pad_start(width: Int, fill = ' '): String`, `pad_end(width: Int, fill = ' '): String`
- `to_upper(): String`, `to_lower(): String`

### Binary

[Binary](types.md#binary). `b.length: Int` is a property.

- `add(other: Binary): Binary`
- `is_empty(): Bool`
- `get(index: Int): Byte?`, `first(): Byte?`, `last(): Byte?`
- `starts_with(prefix: Binary): Bool`, `ends_with(suffix: Binary): Bool`
- `occurs_at(index: Int, part: Binary): Bool`
- `index_of(part: Binary | Byte, from: Int = 0): Int?`
- `iter(): Iter<Byte>`
- `text(start = 0, end: Int = length): String?`

### Arrays

[Array](types.md#array). `xs.length: Int` is a property.

- `push(item: T)`, `pop(): T`
- `iter(): Iter<T>`
- `is_empty(): Bool`
- `first(): T?`, `last(): T?`, `get(index: Int): T?`
- `sorted(compare: (T, T) -> Ordering = (a, b) -> a.compare(b)): T[]`
- `sorted_by<K: Comparable>(key: (T) -> K): T[]`
- `sort(compare: (T, T) -> Ordering = (a, b) -> a.compare(b))`
- `sort_by<K: Comparable>(key: (T) -> K)`
- `append(items: T[])`
- `reversed(): T[]`
- `truncate(length: Int)`, `split_off(at: Int): T[]`
- `all_but_last(): T[]`
- Of [Equatable](#equatable-comparable-and-hashable) items: `contains(item: T): Bool`, `index_of(item: T): Int?`, `remove(item: T): Bool`
- Of [Literal](#literal) items: `to_string(): String`, `to_literal(): String` (see [Stringable](#stringable))
- Of a `String[]` or a `Char[]`: `join(separator = ''): String`, the parts one after another, with the separator between each two
- Of a `Binary[]`: `join(separator: Binary = b''): Binary`
- Of a `Byte[]`: `to_binary(): Binary`

### Map

[Map](types.md#map). `m.length: Int` is a property.

- `is_empty(): Bool`
- `contains(key: K): Bool`
- `remove(key: K): Bool`
- `keys(): Iter<K>`, `values(): Iter<V>`, `entries(): Iter<(K, V)>`
- `get_or_add(key: K, make: () -> V): V`: the value of the key, or else what `make` makes, which the map then holds under it
- Of [Literal](#literal) keys and values: `to_string(): String`, `to_literal(): String` (see [Stringable](#stringable))

### Set

[Set](types.md#set). `s.length: Int` is a property.

- `is_empty(): Bool`
- `contains(item: T): Bool`, `add(item: T): Bool`, `remove(item: T): Bool`
- `iter(): Iter<T>`
- `bit_or`, `bit_and`, `sub`, `bit_xor`: `(other: Set<T>): Set<T>`
- `is_subset(other: Set<T>): Bool`
- Of [Literal](#literal) items: `to_string(): String`, `to_literal(): String` (see [Stringable](#stringable))

### Iter

[Iter](types.md#iter).

- `has_next(): Bool`, `next(): T`
- `iter(): Iter<T>`
- Of an `Iter<String>` or an `Iter<Char>`: `join(separator = ''): String`, as an array's
  - Why of arrays and `Iter`s rather than of an Iterable: an extend of `Iterable<String>` and one of `Iterable<Char>` would clash, as a type may satisfy both, and one of an interface takes its object as an interface value, which an array's loop would then go through an item at a time. Another Iterable joins by its `iter()`: `names.iter().join(', ')` of a set.

### Promise

[Promise](types.md#promise) and [functions that await](functions.md#functions-that-await).

- `is_settled(): Bool`
- `cancel()`

### Enums

[Enums](types.md#enums).

- `to_string(): String`, `to_literal(): String`
- The member of a text, and the members in order: `parse` and `members` of [std:enums](std.md#stdenums).
