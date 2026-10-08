# Builtins

Builtins need no import. Most are written in Lerta, in `std/builtins.lerta`, the module `'std:builtins'`, which every other module but `std:io` imports as `import 'std:builtins'` (see [modules](modules.md)); what it exports is a builtin, and a module's own names shadow them.

- `print<T: Stringable>(x: T)` writes `x.to_string()` and a newline with `stdout.write` of [std:io](modules.md#stdio), so the output of the two keeps its order. stdout is flushed when the program exits.

## Stringable

`Stringable` is the bound of a type parameter (see [generic functions](functions.md#generic-functions)) satisfied by the types that have a method `to_string(): String`: `String`, `Int`, `UInt8` and `Bool`, and any type that declares one or gets one from an extend in effect. A field that holds a function does not count, nor does a `to_string` with parameters or another result. `Int?`, unions and arrays are not `Stringable`, unless an extend gives them `to_string`. String interpolation, `"#{x}"`, requires a `Stringable` value and inserts `x.to_string()` (see [syntax](syntax.md)).

## Methods of the builtin types

The methods of the builtin types (see [types](types.md)) are written in Lerta, as extends of `std/builtins.lerta` (see [objects](objects.md#extend)), except those that the compiler gives them:

| Type | In `std/builtins.lerta` | Built into the compiler |
|---|---|---|
| `Int` | `to_string` | |
| `UInt8` | `to_int`, `to_string` | |
| `Bool` | `to_string` | |
| `String` | `to_string`, `parse_int`, `split` | `binary` |
| `Binary` | `slice`, `decode_utf8` | `length` |
| `Array<T>` | `iter`, `map`, `filter`, and `join` of an `Array<String>` | `length`, `push`, `pop`, `take` |
| `Map<K, V>` | `has` | `length`, `remove`, `keys` |
| `Iter<T>` | `map`, `filter`, `to_array` | `has_next`, `next`, `take` |

A `Bool` gives `true` or `false` as its text, and a `UInt8` a number. Why each of the others is built in is in [internals](../internals.md#builtins).
