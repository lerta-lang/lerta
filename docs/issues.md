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

### A `deinit` at the end of the program can read a released top-level value

The top-level values are released in reverse order, but their initialized flags stay set, so a `deinit` that runs then reads a value already released instead of failing the initialized check. The debug runtime aborts with `retain of a dropped object`.

```
class N
  v: Int
  deinit = -> print g[0]
const n = N(v: 1)
const g = ["gone #{n.v}"]
```

Cause: `emit_release_globals` in `compiler/codegen/top_level.lerta` does not clear the flags.

### Sizes are cut to 32 bits on 32-bit targets (unconfirmed)

A request of 4 GiB or more is converted to `size_t` unchecked, so the mapping is smaller than the region claims: `lerta_os_map_region` in `runtime/platform_posix.c` and `runtime/platform_windows.c`, and the capacity in `lerta_read_chunks` (`runtime/file.c`). It takes a 2 GiB array or file first.

## Compiler

### A declaration in a `finally` body crashes the compiler

```
try
  print 'body'
finally
  const note = 'done'
  print note
```

The compiler aborts with `'note' is already defined in this scope`. The finally body is generated twice, for the normal path and the rethrow, both in the enclosing scope without one of its own (`compiler/codegen/exceptions.lerta`).

### Field types of generic instances are not checked

A type argument that makes a field type invalid, as `T?` in an array or a map, or a key that `==` does not compare, is accepted for a generic class or struct, and the program fails in LLVM.

```
class Box<T>
  items: T[] = []
  put = (v: T) -> @items.push v
const b = Box<Int?>()
b.put 1
```

Cause: `add_instance` and `instance_field` in `compiler/checker/object_types.lerta` substitute the field types without the checks that `reject_invalid_signature` (`compiler/checker/generic_call.lerta`) makes for generic functions.

### A jump in the value of a compound assignment leaks the old value

A `return`, `break` or `continue` in the value of `+=` and the like on a `var` of a reference type leaks the value the `var` had.

```
const m: Map<String, String> = { 'a': 'x' }
const f = (): String ->
  var acc = 'start' + '!'
  acc += m['missing'] ? return acc
  acc
print f()
```

The program prints `leak: 1 object(s)`. `assign_through` in `compiler/codegen/assignment.lerta` holds the old value as a temporary, which jumps do not release, while `compiler/checker/jump_positions.lerta` allows jumps in the value of any assignment to a name.

### A path of fields from an imported `const` is not narrowed

```
import A, shared from './boxes'   # export const shared = Box(item: A(x: 9))
print shared.item is A then shared.item.x else 0
```

The checker reports `'x' is not a field of B`. `value_local` in `compiler/checker/imports.lerta` makes a new `Local` at each lookup, and `narrowed_field_type` in `compiler/checker/narrowable.lerta` compares the roots by identity.

### `return return 1` is accepted

The operand of `return` is not among the places where [control flow](reference/control-flow.md) allows `return`, and `print(return 1)` is rejected.

### A `const` may take the name of a builtin type

`const Int = 3` is accepted, while `class Int` is rejected as already defined, though types and values share one namespace.

### `-0` where a Float is expected is `0.0`

`const c: Float = -0` prints `0.0`, while `-(0)` gives `-0.0`. The parser folds `-0` into the integer literal 0 (`compiler/parser/expression.lerta`), and codegen makes it `0.0` (`compiler/codegen/expression.lerta`).

### Parsing takes cubic time in the nesting of parentheses

`print ((…1…))` with 800 levels takes 4.5 s, and with 2000 more than a minute. At each `(`, `looks_like_function_literal` (`compiler/parser/compound.lerta`) finds the closing one through `peek_at`, which counts from the current token each time (`compiler/parser/token_stream.lerta`).

### Diagnostics

- `const r = d?.die()`, where `die` returns `never`, reports that nil alone does not give the type of the branches of `if`, which names neither `?.` nor `never` (`unify_values` in `compiler/checker/case.lerta`).
- `print 1e+` reports the literal as `'1e'` (`scan_number` in `compiler/lexer/tokens.lerta`).

## Runtime

### macOS fails to write or read 2 GiB or more at once

macOS rejects a `read` or `write` of more than `INT_MAX` bytes with `EINVAL`, where Linux does part of it. `lerta_os_write` and `read_fd` in `runtime/platform_posix.c` pass the whole length; the Windows versions take 1 GiB at a time. So `write_file` and `print` of 2 GiB fail, and `read_file` of a file of 2 GiB or more.

### Output to a non-blocking stdout is dropped

When stdout is a non-blocking pipe, as Node.js gives a child, a full pipe makes `write` fail with `EAGAIN`, which `lerta_os_write` takes as a failure: the output from then on is dropped without a message, and the program exits with 1 (`runtime/platform_posix.c`, `runtime/io.c`).

### Smaller ones (unconfirmed)

- `incomplete_tail` in `runtime/platform_windows.c` keeps an invalid byte of `0xC0` or above as the start of a character, so a console write ending with it does not show it.
- After a failed `uv_spawn`, `runtime/loop.c` closes the handle that libuv has already removed from its queue, which only matters when the spawn fails in fork or pipe creation.

## Commands and tools

- A value or a path that starts with `-` cannot be given, as any such argument is taken as a flag (`is_value` in `compiler/main.lerta`).
- `lerta build` killed while it compiles the runtime leaves its `.staging-` directory in the cache (`compiler/runtime_cache.lerta`; unconfirmed).
- `build/host_llvm.sed` depends on nothing, so it is not made again when clang changes across the change of `llvm.coro.end` (`Makefile`; unconfirmed).

## Open questions

Behavior the reference leaves open, to decide before it is fixed or documented as is:

- SIGPIPE is not ignored, so `program | head -1` ends the program with status 141 instead of through the failure of stdout.
- A map stores the Float key `-0.0` as `0.0`.
- An integer literal beyond `Int` is rejected where a Float is expected.
- A list of `when` patterns cannot be broken across lines, so a long one goes past 100 columns.
