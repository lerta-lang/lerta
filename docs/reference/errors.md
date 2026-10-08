# Errors

## Exceptions

`throw message` stops the program with a `String` message. It is an expression of type `never`, so it can stand wherever a value is expected (`case` arms, `x ? throw 'missing'`); `never` does not count when the types of arms or returns are combined, and a function may end with it.

An uncaught exception prints its message and a newline to stderr, after flushing stdout, and the program exits with status 1. There is no `catch` yet, so every exception is uncaught.

## Panics

A panic prints its message and a newline to stderr, after flushing stdout, and aborts the program; it cannot be caught. Running out of memory panics with `out of memory`, and recursing too deep with `stack overflow`.

## Discarded values

These apply when a value in statement position is not captured.

- A literal or an operator expression (`'a'`, `1 + 2`, `x == 1`) → error. An unused comparison often means a mistyped assignment.
- A function value itself (`print`) → error "to call it, write `print()`".
- An [`Iter`](types.md#iter) (`xs.map(f)`) → error "an Iter does nothing until it is consumed".
- A call, or an expression with no value such as a `case` whose arms are calls to `void` functions → allowed.

## Unused names

A `const` or `var` that is never read (assigning to it does not count) produces a warning, unless its name starts with `_`. A top-level one may be read by any function, so it is warned about only when the whole module compiles.
