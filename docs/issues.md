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

### Sizes are cut to 32 bits on 32-bit targets (unconfirmed)

A request of 4 GiB or more is converted to `size_t` unchecked, so the mapping is smaller than the region claims: `lerta_os_map_region` in `runtime/platform_posix.c` and `runtime/platform_windows.c`, and the capacity in `lerta_read_chunks` (`runtime/file.c`). It takes a 2 GiB array or file first.

## Compiler

### A `const` may take the name of a builtin type

`const Int = 3` is accepted, while `class Int` is rejected as already defined, though types and values share one namespace.

## Runtime

### Smaller ones (unconfirmed)

- `incomplete_tail` in `runtime/platform_windows.c` keeps an invalid byte of `0xC0` or above as the start of a character, so a console write ending with it does not show it.
- After a failed `uv_spawn`, `runtime/loop.c` closes the handle that libuv has already removed from its queue, which only matters when the spawn fails in fork or pipe creation.

## Commands and tools

- A value or a path that starts with `-` cannot be given, as any such argument is taken as a flag (`is_value` in `compiler/main.lerta`).
- `lerta build` killed while it compiles the runtime leaves its `.staging-` directory in the cache (`compiler/runtime_cache.lerta`; unconfirmed).

## Open questions

Behavior the reference leaves open, to decide before it is fixed or documented as is:

- SIGPIPE is not ignored, so `program | head -1` ends the program with status 141 instead of through the failure of stdout.
- A map stores the Float key `-0.0` as `0.0`.
- An integer literal beyond `Int` is rejected where a Float is expected.
- A list of `when` patterns cannot be broken across lines, so a long one goes past 100 columns.
