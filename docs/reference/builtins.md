# Builtins

Builtins need no import.

- `print(x: Stringable)` writes `x` and a newline to stdout. `String`, `Int`, `UInt8` and `Bool` are `Stringable`; a `Bool` prints as `true` or `false`, and a `UInt8` as a number.

stdout is buffered and flushed when the program exits.
