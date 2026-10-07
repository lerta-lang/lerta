# Errors

## Exceptions

An uncaught exception prints its message and a newline to stderr, after flushing stdout, and the program exits with status 1. stage0 has no `catch`, so every exception is uncaught.

## Discarded values

These apply when a value in statement position is not captured.

- A literal or an operator expression (`'a'`, `1 + 2`, `x == 1`) → error. An unused comparison often means a mistyped assignment.
- A function value itself (`print`) → error "to call it, write `print()`".
- A call, or an expression with no value such as a `case` whose arms are calls to `void` functions → allowed.
