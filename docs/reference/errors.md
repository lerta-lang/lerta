# Errors

## Exceptions

An uncaught exception prints its message and a newline to stderr, after flushing stdout, and the program exits with status 1. stage0 has no `catch`, so every exception is uncaught.

## Discarded values

These apply when a value in statement position is not captured.

- A literal (`'a'`) → error.
- A function value itself (`print`) → error "to call it, write `print()`".
- A call → allowed.
