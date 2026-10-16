# Known issues

Defects of what is implemented: where the implementation departs from [the reference](reference/README.md) or [the internals](internals.md), or fails without a cause in the program. Each is removed when it is fixed. What is not implemented yet is in [the roadmap](roadmap/README.md).

Each entry says what goes wrong, a minimal program that shows it, and where the cause is. An entry marked *unconfirmed* was found by reading the code and has not been reproduced.

## Compiler

### A generic class whose field holds a larger instance of itself hangs the compiler

```
class Node<T>
  next: Node<Node<T>>? = nil
const n: Node<Int>? = nil
```

The compiler never ends: the instances of the class it makes grow without end. It did so before the fields of instances were checked too. Checking each generic declaration once for what its type parameters must be, rather than each instance's fields, would also give the check of interface instances (`compiler/checker/type_validity.lerta`) the errors it skips for an instance nested in one of the same interface.

## Commands and tools

- A value or a path that starts with `-` cannot be given, as any such argument is taken as a flag (`is_value` in `compiler/main.lerta`).
- `lerta build` killed while it compiles the runtime leaves its `.staging-` directory in the cache (`compiler/runtime_cache.lerta`; unconfirmed).

## Open questions

Behavior the reference leaves open, to decide before it is fixed or documented as is:

- SIGPIPE is not ignored, so `program | head -1` ends the program with status 141 instead of through the failure of stdout.
- A map stores the Float key `-0.0` as `0.0`.
- An integer literal beyond `Int` is rejected where a Float is expected.
- A list of `when` patterns cannot be broken across lines, so a long one goes past 100 columns.
