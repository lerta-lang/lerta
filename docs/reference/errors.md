# Errors

## Exceptions

```
struct NotFound: Error

const find = (key: String): Int ->
  throw NotFound(message: "no #{key}") if key != 'a'
  1

const n = try
  find('b')
catch e: NotFound
  print e.message
  0
finally
  print 'done'
```

- `throw value` throws an exception: a value of a type that satisfies `interface Error` of `std:builtins`, whose one member is `message: String`, converted to an `Error` as a value converts to an [interface type](objects.md#interfaces), so a class or struct, which a program declares for its own errors, as `struct NotFound: Error` (see [declaring an interface](objects.md#interfaces)). It is an expression of type `never`, so it can stand wherever a value is expected (`case` arms, `x ? throw NotFound(message: 'missing')`); `never` does not count when the types of arms or returns are combined, and a function may end with it.
- The runtime's errors are exceptions too, of types that `std:builtins` declares, each a struct of one field, `message`:

  | Type | Thrown by |
  |---|---|
  | `IndexError` | an index or a slice out of range, `pop` of an empty array |
  | `ArithmeticError` | integer overflow, division by zero, `to_byte` of an Int out of 0 to 255 |
  | `NilError` | `x!` of nil |
  | `CastError` | `x as T!` of a value of another type |
  | `IterError` | a second traversal of an `Iter`, `next` past its end |
  | `WeakError` | a `weak!` field whose object is gone |
  | `IOError` | a file that cannot be read or written, a command that cannot be run |
  | `ValueError` | an argument of a value that a function does not take, as `split('')`, `exit(256)` |
  | `InitError` | a top-level value used before it is initialized (see [functions](functions.md)) |
- A `String` cannot be thrown: `throw` takes an `Error`, so that a `catch` can tell errors apart by type.
- `try` runs its block. An exception thrown there, in it or in a function it calls, goes to its `catch` clauses, tried in order: `catch e: T` takes an exception whose type is `T`, or a member of the union `T`, as `is` tells, and its block sees it as `e`, of that type; `catch e` takes any, `e` being an `Error`. A type that a catch names must be a class or struct, or a union of them, that satisfies `Error`. An exception that no catch takes goes on, as from where the `try` is.
- `finally` and its block, after the catches, run after the try block or the catch that ran, and before an exception goes on, the one that no catch takes or that a catch throws. A `try` has at least one `catch` or a `finally`. `return`, `break` and `continue` cannot leave a `try` that has a `finally` yet.
- `try` is an expression: its value is that of its block, or of the catch that ran, which must have one type, as the arms of a `case` must (see [control flow](control-flow.md)); if one of them gives none, it gives none. The value of `finally` is discarded.
- On its way, an exception releases what it leaves: the values of the expressions it interrupts, the locals of the blocks and the functions it leaves, and the fields of an object it interrupts the construction of, whose `deinit` does not run.
- An uncaught exception prints its message and a newline to stderr, after flushing stdout, and the program exits with status 1.
- Why exceptions propagate as a pending exception checked after each call, rather than by unwinding the machine stack, is in [internals](../internals.md#exceptions).

## Panics

A panic prints its message and a newline to stderr, after flushing stdout, and aborts the program; it cannot be caught. `panic(message)`, of `std:builtins`, panics: for a bug that no caller could handle, such as a broken invariant, where an exception could be caught by mistake. Running out of memory panics with `out of memory`, and recursing too deep with `stack overflow`. The runtime also panics when its internal invariants are violated or a system call it cannot do without fails, such as `deinit kept a reference to its object` or `deinit threw an exception` or `cannot wait for a child process`.

## Discarded values

These apply when a value in statement position is not captured.

- A literal, a name, an operator expression, a field or an index (`'a'`, `x`, `1 + 2`, `x == 1`, `p.x`, `xs[0]`) → error. An unused comparison often means a mistyped assignment.
- A function value itself (`print`) → error "to call it, write `print()`".
- An [`Iter`](types.md#iter) (`xs.map(f)`) → error "an Iter does nothing until it is consumed".
- A call, or an expression with no value such as a `case` whose arms are calls to `void` functions → allowed.

## Unused names

A `const` or `var` that is never read (assigning to it does not count) produces a warning, unless its name starts with `_`. A top-level one may be read by any function, so it is warned about only when the whole module compiles.
