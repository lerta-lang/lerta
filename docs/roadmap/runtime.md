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

- **`throw` and `try`/`catch`/`finally` blocks** (same form as JS).
  ```
  try
    risky()
  catch e: IOError
    log e
  finally
    cleanup()
  ```
  - `catch e: T` catches only exceptions of type `T`; others propagate unchanged (preventing unrelated exceptions from being swallowed). Several `catch` clauses may be listed. Omitting the type catches all exceptions (the name of the common type is undecided).
  - `try`/`catch` is an expression with a value. If any arm is `void`, the whole is `void`. The value of `finally` is discarded.
  - No `throws` annotation is needed (if written, it is type-checked). There is no `try` attached to calls (as in Swift).
- Exception types, which `throw` takes instead of only a `String` message.
- The frame chain (see [internals](../internals.md#frame-chain-planned)); the implementation strategy is an [open question](#open-questions).
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

- The name of the type common to all exceptions (the type caught by an untyped `catch`).
- Whether stack overflow should be an exception that can be caught instead of a panic. That needs the check at function entry described in [internals](../internals.md#stack-overflow).
- The exception implementation strategy (choose from [the candidates](../internals.md#exception-implementation-planned-undecided-candidates)).
- Value semantics for arrays (copy-on-write), or detection of modification during iteration.
- The type of asynchronous results (its name, and the type of async functions that return no value).
- How to pass values to workers (candidates: deep copy only + sharing immutable `Binary` / run-time moves like JS transfer).
