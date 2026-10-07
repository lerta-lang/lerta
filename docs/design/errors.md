# Exceptions and safety

## Safety

The definition of safety is in [philosophy.md](../philosophy.md#safety). Concretely:

- Bounds checks (`a[i]` throws when out of range; `a.get(i)` returns `T | nil`).
- Signed integer overflow and division by zero throw (exception).
- Nil safety, weak safety, no data races (solved by design).
- Modification during iteration is detected and throws (the Java approach), or is defined by the specification.
- FFI and raw pointer operations only inside `unsafe` blocks.

## Rules for discarded values

These apply when a value in statement position is not captured.

Literals, arithmetic and comparisons, and function values are implemented: see [the reference](../reference/errors.md#discarded-values). Planned:

- Other operator expressions and field access (`obj.x`) → **error** (no side effects; same as Go).
- A call returning `Iter<T>` (`xs.map f`) → **error** "does nothing until consumed" (equivalent to Rust's `#[must_use]`; an essential diagnostic for laziness).
- Methods of immutable types (`String`, `Binary`) that return a new value (`s.trim()`) → **error** (since the type is immutable, the type shows that "discarding = doing nothing").
- Other calls to non-`void` functions → allowed (interpreted as calls for side effects). A `must_use` annotation can make individual ones an error.
- Unused `const`/`var`/`import` → warning.

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
- Only throws can be caught. A [panic](#panic) stops the process.
- Exceptions inside async functions are carried as the failure value of the asynchronous result.
- For servers, exceptions are caught at the task boundary of the event loop and only that task is discarded.

## Panic

A panic cannot be caught. It prints the message (and a stack trace if available) to stderr and exits with a non-zero code.

These cause a panic:

- Allocation failure.
- Violation of the runtime's internal invariants (for example a corrupted reference count; things that should never happen).
- Stack overflow. The handler itself needs stack, so it cannot be an exception (Go also treats it as fatal).
