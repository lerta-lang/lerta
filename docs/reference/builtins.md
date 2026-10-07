# Builtins

Builtins need no import.

- `print(x: Stringable)` writes `x` and a newline to stdout. `String`, `Int` and `Bool` are `Stringable`; a `Bool` prints as `true` or `false`.

stdout is buffered and flushed when the program exits.
