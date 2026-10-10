# Builtins

Builtins need no import. Most are written in Lerta, in `std/builtins.lerta`, the module `'std:builtins'`, which every other module but `std:io` imports as `import 'std:builtins'` (see [modules](modules.md)); what it exports is a builtin, and a module's own names shadow them.

- `print<T: Stringable>(x: T)` writes `x.to_string()` followed by a newline, in one `stdout.write` of [std:io](modules.md#stdio), so the output of the two keeps its order.

## Stringable

`Stringable` is a builtin [interface](objects.md#interfaces) with one member, `to_string: () -> String`. `String`, `Int`, `Byte`, `Bool` and enums satisfy it, and so does any type that declares `to_string`, as a method or a field that holds a function, or gets it from an extend in effect; a `to_string` with parameters or another result does not. A module's own name `Stringable` shadows it. `Int?`, unions and arrays are not `Stringable`, unless an extend gives them `to_string`. String interpolation, `"#{x}"`, requires a `Stringable` value and inserts `x.to_string()` (see [syntax](syntax.md)).

## Methods of the builtin types

The methods of the builtin types (see [types](types.md)) are written in Lerta, as extends of `std/builtins.lerta` (see [objects](objects.md#extend)), except those that the compiler gives them:

| Type | In `std/builtins.lerta` | Built into the compiler |
|---|---|---|
| `Int` | `to_string`, `to_byte` | |
| `Byte` | `to_int`, `to_string`, `is_digit`, `is_letter`, `is_space` | |
| `Bool` | `to_string` | |
| `String` | `to_string`, `parse_int`, `split`, `starts_with` | `binary` |
| `Binary` | `slice`, `occurs_at`, `decode_utf8`, `text` | `length` |
| `Array<T>` | `iter`, `map`, `filter`, `any`, `all`, `find`, `contains`, `find_index`, `last`, `append`, `join` of an `Array<String>` and `to_binary` of an `Array<Byte>` | `length`, `push`, `pop`, `take` |
| `Map<K, V>` | `has`, `get_or_put`, and `add` of a `Map<K, Bool>` | `length`, `remove`, `keys` |
| `Iter<T>` | `map`, `filter`, `to_array`, `any`, `all`, `find` | `has_next`, `next`, `take` |
| An [enum](types.md#enums) | | `to_string`, and the static `E.parse` |

A `Bool` gives `true` or `false` as its text, and a `Byte` a number. Why each of the others is built in is in [internals](../internals.md#builtins).
