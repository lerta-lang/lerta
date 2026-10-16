# Known issues

Defects of what is implemented: where the implementation departs from [the reference](reference/README.md) or [the internals](internals.md), or fails without a cause in the program. Each is removed when it is fixed. What is not implemented yet is in [the roadmap](roadmap/README.md).

Each entry says what goes wrong, a minimal program that shows it, and where the cause is. An entry marked *unconfirmed* was found by reading the code and has not been reproduced.

## Memory safety

### An object that `init` lets escape is freed when `init` throws

When `init` stores `@` somewhere and then throws, the unwinding frees the object without regard to the other references, and does not detach its weak box. The debug runtime aborts with `retain of a dropped object`; with `-O` the program crashes or reads freed memory.

```
struct Oops: Error
class Registry
  items: Node[] = []
const registry = Registry()
class Node
  name: String
  init = ->
    registry.items.push @
    throw Oops(message: 'after escape')
try
  const _n = Node(name: 'n1')
catch e: Oops
  print e.message
print registry.items[0].name
```

Cause: `unwind_cleanup` in `compiler/codegen/function.lerta` calls `lerta_free_unfinished`, which frees regardless of the reference count (`runtime/memory.c`).

## Compiler

### A `const` may take the name of a builtin type

`const Int = 3` is accepted, while `class Int` is rejected as already defined, though types and values share one namespace.

### An integer literal is not a Float where a `Float?` is expected

`const e: Float? = 1` is rejected with `expected Float?, got Int`, though an integer literal is a Float where a Float is expected; so is `-0 as Float ? 1.0`. The reference does not say whether a `Float?` counts, so this may need deciding first.

### A generic interface is not checked for the member types its type arguments make

`Source<Int?>`, for an interface whose member returns `T[]`, is accepted where it is written, though an array cannot hold `Int?`; no class can satisfy it, so the error comes only where one is given for it.

## Runtime

### A spawn that fails to make the output pipe leaves libuv's handle queue broken

When `uv_spawn` on Unix fails to make or open a pipe for the child's stdio, it removes the process handle from the loop's handle queue itself. `lerta_loop_run_program` in `runtime/loop.c` then closes the handle as after any failure, and libuv removes it again. With the output pipe, which is closed later but finishes closing first, this sets the queue's last link to the pipe in the freed program. A fork or exec failure leaves the handle in the queue, and Windows never removes it, so the fix must tell the cases apart, which libuv's API does not.

## Commands and tools

- A value or a path that starts with `-` cannot be given, as any such argument is taken as a flag (`is_value` in `compiler/main.lerta`).
- `lerta build` killed while it compiles the runtime leaves its `.staging-` directory in the cache (`compiler/runtime_cache.lerta`; unconfirmed).

## Open questions

Behavior the reference leaves open, to decide before it is fixed or documented as is:

- SIGPIPE is not ignored, so `program | head -1` ends the program with status 141 instead of through the failure of stdout.
- A map stores the Float key `-0.0` as `0.0`.
- An integer literal beyond `Int` is rejected where a Float is expected.
- A list of `when` patterns cannot be broken across lines, so a long one goes past 100 columns.
