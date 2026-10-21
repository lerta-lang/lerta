# Builtins

Builtins need no import. Most are written in Lerta, in the files of `std/builtins/`, by topic, which `std/builtins.lerta`, the module `'std:builtins'`, exports from (see [exports](modules.md#exports)); every other module imports it as `import 'std:builtins'` (see [modules](modules.md)). What it exports is a builtin, and a module's own names shadow them.

- `panic(message: String): never` stops the program at once (see [panics](errors.md#panics)).
- `Error` is the interface of what `throw` takes, and the runtime's error types are builtins too (see [exceptions](errors.md#exceptions)).
- `print<T: Stringable>(x: T)` writes `x.to_string()` followed by a newline to stdout, and `print_error<T: Stringable>(x: T)` to stderr. Each writes at once, unbuffered, so that what it prints is out even if a long computation follows, and after what the buffer of `stdout` and `stderr` of [std:io](modules.md#stdio) holds, once a write out of it in flight is done, so that the output keeps its order. A failed write to stdout is reported by the exit code, as [std:io](modules.md#stdio) states.
- `min<T: Comparable>(first: T, rest: T...): T` gives the least of its arguments, and `max` the greatest, by their [compare](#equatable-comparable-and-hashable): `min(3, 1, 2)` is `1`, `max(0, xs...)` the greatest of `0` and the items of `xs`. Of values that are equal, it gives the first. `T` is that of the arguments, which [infer it](functions.md#generic-functions) as for any generic function, so `min(1.0, 2)` compares `Float`s while `min(1, 2.5)` is an error. A first value comes outside any spread, as `first` is no variadic parameter: `min(xs...)` alone is an error.

## Stringable

`Stringable` is a builtin [interface](objects.md#interfaces), of `std:builtins`, with one member, `to_string: () -> String`. `String`, `Int`, `Float`, `Byte`, `Char`, `Bool` and enums satisfy it, and so does any type that declares `to_string`, as a method or a field that holds a function, or gets it from an extend in effect; a `to_string` with parameters or another result does not. A module's own name `Stringable` shadows it. An array is `Stringable` when its items are [Literal](#literal), each written as the literal that gives it: `[1, 2]`, `[[1], []]`, `['a', "it's"]`. Its `to_string` comes from an extend of std, which no other extend can declare again: a type whose arrays should read otherwise gives its items a `to_literal` of their own. `Int?` and the arrays of other items are not `Stringable`. String interpolation goes through it (see [syntax](syntax.md)).

## Literal

`Literal` is a builtin interface, of `std:builtins`, with one member, `to_literal: () -> String`: the text of the literal that gives the value, as the text of an array writes its items. A `String` is in single quotes if it has no `'` and no control character, and otherwise in double quotes, with `\\`, `\"`, `\#`, `\n`, `\t`, `\r` and `\0` escaped and the other control characters as `\u{7F}`; a `Char` is the `String` of it; an enum value is its member as declared, its name or the literal of its text; the numbers and `Bool` are their `to_string()`, and so is an array of `Literal` items, `[1, 2]`. Any type that declares `to_literal` satisfies it, as one does `Stringable`, with a text that writes its value as the program would.

## Iterable

`Iterable<T>` is a builtin [interface](objects.md#interfaces), of `std:builtins`, with one member, `iter: () -> Iter<T>`, which `for` and comprehensions go through (see [control flow](control-flow.md#for-and-ranges)). An extend of it gives every Iterable `map`, `filter`, `take`, `zip`, `any`, `all`, `find`, `min_by`, `max_by` and `to_array`, one of `Iterable<T>` where `T` is [Comparable](#equatable-comparable-and-hashable) `min` and `max`, and one where `T` is [Add<T, T>](#operators) `sum`, which work as those of [Iter](types.md#iter) do. Arrays, `String`s, `Binary` values and `Iter`s satisfy it, an `Iter`'s `iter()` giving itself, and so does any type that has such an `iter`. A module's own name `Iterable` shadows it.

## Equatable, Comparable and Hashable

Builtin [interfaces](objects.md#interfaces), of `std:builtins`, for bounds such as `<T: Comparable>`:

- `Equatable`: `equals: (Self) -> Bool`.
- `Comparable`: `compare: (Self) -> Ordering`, where the builtin enum `Ordering` has the members `LESS`, `EQUAL` and `GREATER`.
- `Hashable`: `equals: (Self) -> Bool` and `hash: () -> Int`.

Every type that `==` compares has `equals`, which compares as `==` does, and every type that can be a [map key](types.md#map) has `hash`, which equal values share: builtin ones, unless a class or struct declares [its own](objects.md#classes-and-structs), and one that declares `compare` has a builtin `equals` by it. So they satisfy `Equatable` and `Hashable`. The numbers and `String` have a `compare`, and so satisfy `Comparable`, as does a class or struct that declares its own; `<` and the like order by it. A module's own names shadow them.

## Operators

Builtin [interfaces](objects.md#interfaces), of `std:builtins`, for bounds such as `<T: Add<T, T>>`, of the methods that the arithmetic and bitwise operators call (see [operators](objects.md#classes-and-structs)): `Add<Rhs, Out>` (`add: (Rhs) -> Out`), `Sub`, `Mul`, `Div`, `Rem`, `BitAnd`, `BitOr`, `BitXor`, `Shl` and `Shr` likewise, and `Neg<Out>` (`neg: () -> Out`). The numbers have the methods of the operators that apply to them, which apply the operators, throwing as they do (`3.add(4)` is 7), and `String` has `add`, so that `<T: Add<T, T>>` takes an `Int` or a `String` as well as a type that declares `add`.

## Methods of the builtin types

The methods of the builtin types, by type (see [types](types.md) for what each does; how each is written is in [internals](../internals.md#builtins)):

| Type | Methods |
|---|---|
| `Int` | `equals`, `compare`, `hash`, the methods of the operators, `to_string`, `to_float`, the conversions to each integer type (see [sized integers](types.md#sized-integers)), `to_char`, `wrapping_add`, `wrapping_sub`, `wrapping_mul` |
| `Int8`, `Int16`, `Int32`, `UInt16`, `UInt32`, `UInt64` | `equals`, `compare`, `hash`, the methods of the operators, `to_string`, `to_float`, the conversions to each integer type, `to_char`, `wrapping_add`, `wrapping_sub`, `wrapping_mul` |
| `Char` | `equals`, `compare`, `hash`, `add`, `sub`, `to_string`, `to_int`, `is_digit`, `is_letter`, `is_space` |
| `Float` | `equals`, `compare`, `hash`, the methods of the operators, `to_string`, `to_fixed`, `to_int`, `to_float32` |
| `Float32` | `equals`, `compare`, `hash`, the methods of the operators, `to_string`, `to_float` |
| `Byte` | `equals`, `compare`, `hash`, the methods of the operators, `to_string`, `to_float`, the conversions to each integer type, `to_char`, `wrapping_add`, `wrapping_sub`, `wrapping_mul`, `is_digit`, `is_letter`, `is_space`, `is_utf8_continuation` |
| `Bool` | `equals`, `hash`, `to_string` |
| `String` | `equals`, `hash`, `add`, `to_string`, `iter`, `binary`, `parse_int`, `parse_float`, `split`, `starts_with`, `ends_with`, `without_prefix`, `without_suffix`, `contains`, `split_once`, `replace`, `trim`, `repeat`, `pad_start`, `pad_end`, `to_upper`, `to_lower`, `compare` |
| `Binary` | `equals`, `hash`, `length`, `iter`, `slice`, `occurs_at`, `text` |
| `T[]` | `equals` and `hash` (see [Equatable and Hashable](#equatable-comparable-and-hashable)), `length`, `push`, `pop`, `to_string` (see [Stringable](#stringable)), `iter`, `contains`, `find_index`, `first`, `last`, `sorted`, `append`, `join` of a `String[]` or a `Binary[]` and `to_binary` of a `Byte[]` |
| `Map<K, V>` | `length`, `has`, `get_or_put`, `remove`, `keys`, `values`, `entries` |
| `Set<T>` | `length`, `has`, `add`, `remove`, `iter`, `bit_or`, `bit_and`, `sub`, `bit_xor`, `is_subset` |
| `Iter<T>` | `has_next`, `next`, `iter` |
| Any [Iterable](#iterable) | those that [Iterable](#iterable) gives |
| An [enum](types.md#enums) | `equals`, `hash`, `to_string`, and the static `E.parse` |

A `Bool` gives `true` or `false` as its text, and a `Byte` a number.
