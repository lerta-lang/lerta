# Builtins

Builtins need no import. They are written in Lerta, in `std/builtins.lerta`, the module `'std:builtins'`, which every other module imports as `import 'std:builtins'`; what it exports is a builtin, and a module's own names shadow them.

- `print<T: Stringable>(x: T)` writes `x.to_string()` and a newline to stdout, through the buffer of `stdout` of [std:io](modules.md#stdio), so the output of the two keeps its order. stdout is flushed when the program exits.

## Stringable

`Stringable` is the bound of a type parameter (see [generic functions](functions.md#generic-functions)) satisfied by the types that have a method `to_string(): String`: `String`, `Int`, `UInt8` and `Bool`, and any class or struct that declares one or gets one from an extend in effect. A field that holds a function does not count, nor does a `to_string` with parameters or another result. `Int?`, unions and arrays are not `Stringable`. String interpolation, `"#{x}"`, requires a `Stringable` value and inserts `x.to_string()` (see [syntax](syntax.md)).

## Methods of the builtin types

The methods of the builtin types that are not generic (see [types](types.md)) are written in Lerta too, as extends (see [objects](objects.md#extend)), in `std/builtins.lerta`: `to_string` of `String`, `Int`, `UInt8` and `Bool`, `to_int` of `UInt8`, `parse_int` of `String`, and `slice` and `decode_utf8` of `Binary`; a `Bool` gives `true` or `false`, and a `UInt8` a number. The methods of `Array`, `Map` and `Iter` are built into the compiler.
