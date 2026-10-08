# Builtins

Builtins need no import.

- `print(x: Stringable)` writes `x` and a newline to stdout. `String`, `Int`, `UInt8` and `Bool` are `Stringable`; a `Bool` prints as `true` or `false`, and a `UInt8` as a number.

stdout is buffered and flushed when the program exits.

The methods of the builtin types that are not generic (see [types](types.md)) are written in Lerta, as extends (see [objects](objects.md#extend)), in `std/builtins.lerta`, the module `'std:builtins'`, which every other module imports as `import 'std:builtins'`: `to_string` of `String`, `Int`, `UInt8` and `Bool`, `to_int` of `UInt8`, `parse_int` of `String`, and `slice` and `decode_utf8` of `Binary`. The methods of `Array`, `Map` and `Iter`, `print`, and the conversion of interpolated values to text, are built into the compiler.
