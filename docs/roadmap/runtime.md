# Runtime

The planned design of safety, errors and exceptions, memory management and concurrency.

## Safety

The definition of safety is in [philosophy](../philosophy.md#safety). Planned:

- `a.get(i)` returns `T?` where `a[i]` throws.
- FFI and raw pointer operations only inside `unsafe` blocks.
- A panic prints a stack trace, besides its message.

## Discarded values

These apply when a value in statement position is not captured, beyond [the reference](../reference/errors.md#discarded-values).

- Methods of immutable types (`String`, `Binary`) that return a new value (`s.trim()`) → **error** (since the type is immutable, the type shows that "discarding = doing nothing").
- A `must_use` annotation makes discarding the result of a call to a particular function an error.

## Exceptions

What is implemented, `throw` of `Error` values and `try`/`catch`/`finally`, is in [the reference](../reference/errors.md#exceptions). Planned:

- A `String` cannot be thrown, once the code that throws them, of the compiler and `std:builtins`, throws types of errors of its own: until the seed knows `Error`, a thrown `String` stops the program as before.
- `return`, `break` and `continue` that leave a `try` that has a `finally`, which then runs on the way.
- No `throws` annotation is needed (if written, it is type-checked). There is no `try` attached to calls (as in Swift).
- The runtime's errors, which stop the program now, can be caught, and are of types of `std:builtins`, one for each kind: `IndexError` (an index or a slice out of range, `pop` and `last` of an empty array), `ArithmeticError` (overflow, division by zero), `NilError` (`x!` of nil), `CastError` (`as T!`), `IterError` (a second traversal, `next` past the end), `WeakError` (a `weak!` field whose object is gone), and `IOError` and others of the standard modules.
- Only throws can be caught; a [panic](../reference/errors.md#panics) cannot.
- Exceptions inside async functions are carried as the failure value of the asynchronous result.
- For servers, exceptions are caught at the task boundary of the event loop and only that task is discarded.

## Memory management

- To break a cycle through a closure, put the value in a [`weak var`](objects.md#weak-references) local and capture that.
- Cycles across libraries are left to the leak check of the debug runtime ([internals](../internals.md#leak-checking)).
- The typical cycle (a closure that captures `@`, held through a field of `@`) gets a compiler warning.

## Concurrency

- **async/await and an event loop are core features** (Node-like). The event loop runs on libuv.
- Parallel computation uses **workers that do not share a heap, with message passing** (Node's worker_threads / the Erlang approach).
- Programs stay single-threaded, so data races do not exist: there is no thread API (to avoid the GIL path of Python and Ruby).

## Open questions

- Whether stack overflow should be an exception that can be caught instead of a panic. That needs the check at function entry described in [internals](../internals.md#stack-overflow).
- Value semantics for arrays (copy-on-write), or detection of modification during iteration.
- The type of asynchronous results (its name, and the type of async functions that return no value).
- How to pass values to workers (candidates: deep copy only + sharing immutable `Binary` / run-time moves like JS transfer).
