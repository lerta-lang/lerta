# Builtins

Builtins need no import. Most are written in Lerta, in `std/builtins.lerta`, the module `'std:builtins'`, which every other module imports as `import 'std:builtins'` (see [modules](modules.md)); what it exports is a builtin, and a module's own names shadow them.

- `panic(message: String): never` stops the program at once (see [panics](errors.md#panics)).
- `CodePoint` is an alias of `UInt32` for a Unicode code point, which a `String` gives (see [String](types.md#string)).
- `Error` is the interface of what `throw` takes, and the runtime's error types are builtins too (see [exceptions](errors.md#exceptions)).
- `print<T: Stringable>(x: T)` writes `x.to_string()` followed by a newline to stdout, and `print_error<T: Stringable>(x: T)` to stderr. Each writes at once, unbuffered, so that what it prints is out even if a long computation follows, and after what the buffer of `stdout` and `stderr` of [std:io](modules.md#stdio) holds, once a write out of it in flight is done, so that the output keeps its order. A failed write to stdout is reported by the exit code, as [std:io](modules.md#stdio) states.

## Stringable

`Stringable` is a builtin [interface](objects.md#interfaces), declared in `std/builtins.lerta`, with one member, `to_string: () -> String`. `String`, `Int`, `Float`, `Byte`, `Bool` and enums satisfy it, and so does any type that declares `to_string`, as a method or a field that holds a function, or gets it from an extend in effect; a `to_string` with parameters or another result does not. A module's own name `Stringable` shadows it. An array is `Stringable` when its items are `String`s, `Int`s, `Float`s, `Bool`s, `Byte`s, enum values or such arrays: `[1, 2]`, `[[1], []]`, with a `String` as a literal that gives it, `['a', "it's"]`, in single quotes if it has no `'` and no control character, and otherwise in double quotes with escapes. `Int?`, unions and other arrays are not `Stringable`, unless an extend gives them `to_string`. String interpolation goes through it (see [syntax](syntax.md)).

## Iterable

`Iterable<T>` is a builtin [interface](objects.md#interfaces), declared in `std/builtins.lerta`, with one member, `iter: () -> Iter<T>`, which `for` and comprehensions go through (see [control flow](control-flow.md#for-and-ranges)). An extend of it gives every Iterable `map`, `filter`, `take`, `zip`, `any`, `all`, `find` and `to_array`, which work as those of [Iter](types.md#iter) do. Arrays, `String`s, `Binary` values and `Iter`s satisfy it, an `Iter`'s `iter()` giving itself, and so does any type that has such an `iter`. A module's own name `Iterable` shadows it.

## Equatable, Comparable and Hashable

Builtin [interfaces](objects.md#interfaces), declared in `std/builtins.lerta`, for bounds such as `<T: Comparable>`:

- `Equatable`: `equals: (Self) -> Bool`.
- `Comparable`: `compare: (Self) -> Ordering`, where the builtin enum `Ordering` has the members `LESS`, `EQUAL` and `GREATER`.
- `Hashable`: `equals: (Self) -> Bool` and `hash: () -> Int`.

Every type that `==` compares has `equals`, which compares as `==` does, and every type that can be a [map key](types.md#map) has `hash`, which equal values share: builtin ones, unless a class or struct declares [its own](objects.md#classes-and-structs), and one that declares `compare` has a builtin `equals` by it. So they satisfy `Equatable` and `Hashable`. The numbers and `String` have a `compare`, and so satisfy `Comparable`, as does a class or struct that declares its own; `<` and the like order by it. A module's own names shadow them.

## Methods of the builtin types

The methods of the builtin types, by type (see [types](types.md) for what each does; how each is written is in [internals](../internals.md#builtins)):

| Type | Methods |
|---|---|
| `Int` | `equals`, `compare`, `hash`, `to_string`, `to_float`, the conversions to each integer type (see [sized integers](types.md#sized-integers)), `wrapping_add`, `wrapping_sub`, `wrapping_mul` |
| `Int8`, `Int16`, `Int32`, `UInt16`, `UInt32`, `UInt64` | `equals`, `compare`, `hash`, `to_string`, `to_float`, the conversions to each integer type, `wrapping_add`, `wrapping_sub`, `wrapping_mul` |
| `Float` | `equals`, `compare`, `hash`, `to_string`, `to_int` |
| `Byte` | `equals`, `compare`, `hash`, `to_string`, `to_float`, the conversions to each integer type, `wrapping_add`, `wrapping_sub`, `wrapping_mul`, `is_digit`, `is_letter`, `is_space`, `is_utf8_continuation` |
| `Bool` | `equals`, `hash`, `to_string` |
| `String` | `equals`, `hash`, `to_string`, `iter`, `binary`, `parse_int`, `parse_float`, `split`, `starts_with`, `ends_with`, `without_prefix`, `without_suffix`, `compare` |
| `Binary` | `equals`, `hash`, `length`, `iter`, `slice`, `occurs_at`, `text` |
| `T[]` | `equals` and `hash` (see [Equatable and Hashable](#equatable-comparable-and-hashable)), `length`, `push`, `pop`, `to_string` (see [Stringable](#stringable)), `iter`, `contains`, `find_index`, `first`, `last`, `sorted`, `append`, `join` of a `String[]` and `to_binary` of a `Byte[]` |
| `Map<K, V>` | `length`, `has`, `get_or_put`, `remove`, `keys`, `values`, `entries` |
| `Set<T>` | `length`, `has`, `add`, `remove`, `iter` |
| `Iter<T>` | `has_next`, `next`, `iter` |
| Any [Iterable](#iterable) | those that [Iterable](#iterable) gives |
| An [enum](types.md#enums) | `equals`, `hash`, `to_string`, and the static `E.parse` |

A `Bool` gives `true` or `false` as its text, and a `Byte` a number.
