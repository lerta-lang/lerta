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

- `return`, `break` and `continue` that leave a `try` that has a `finally`, which then runs on the way.
- No `throws` annotation is needed (if written, it is type-checked). There is no `try` attached to calls (as in Swift).
- Only throws can be caught; a [panic](../reference/errors.md#panics) cannot.
- For servers, exceptions are caught at the task boundary of the event loop and only that task is discarded.

## Memory management

For now, cycles stay uncollected ([objects](../reference/objects.md#classes-and-structs)). The plan is to make them hard to write, and to report the ones that are written:

- Cycles across libraries are left to the leak check of the debug runtime ([internals](../internals.md#leak-checking)).
- The warning of a literal that captures `@` and is stored where `@` holds it ([errors](../reference/errors.md#cycles)) extends, with input and output, to a literal given to a method that keeps its argument where its object holds it, as `@button.listen(-> @count += 1)` does if `listen` stores it: a method's parameters that reach a field or a collection are found once, as the method is checked. Callbacks kept by C functions need a way to say so.

### Reference count operations

Every expression of a reference type yields an owned reference for now ([internals](../internals.md#memory-management)), so passing a local to a call retains and releases it around the call. The plan is to borrow where the value cannot go away meanwhile, as a `const` local or a parameter passed as an argument, and emit no retain and release there. In the compiler's front end, `lerta_retain` and `lerta_release` take about a third of the time.

First, the operations that this would remove are counted in the generated code, to see whether the gain is worth the change to the ownership of values in codegen.

### Allocation

Objects are allocated with `malloc` and freed with `free` for now, which take most of the time of a program that makes and drops many small objects, such as `bench/binary_trees`. The plan is an allocator of the runtime's own for small objects, which returns memory to the system:

- **Slabs.** Objects up to 256 bytes are allocated in slabs of 64 KiB, each of one size class, in steps of 16 bytes. A slab starts with its size class, its count of live objects and a list of its free places. A slab is aligned to its size, so that an object's slab is its address with the low 16 bits cleared. Larger objects are allocated with `malloc` as now.
- **Allocation** takes a place from the free list of the size class's current slab; when that slab is full, from another slab of the class with free places, of which each class keeps a list; when there is none, from a new slab. **Freeing** puts the place back on its slab's free list and counts one live object less. Both are a few instructions, which LLVM inlines into the generated code.
- **Returning memory.** A slab whose last object is freed is returned to the system, except for a few, kept for reuse, so that a program that makes and drops the same objects over and over does not get and return a slab each time. A slab that holds one live object stays whole.
- **Slabs come from the system**, not from `malloc`, so that they can be aligned and returned one by one without another libc function: from `mmap` on POSIX, which over-allocates and unmaps what lies outside the alignment, and from `VirtualAlloc` on Windows, whose allocations are aligned to 64 KiB. These are platform functions (see [internals](../internals.md#platforms)), which a microcontroller replaces with a static heap.
- **The debug runtime** counts the objects that it keeps dropped ([internals](../internals.md#use-after-drop-checking)) as live in their slabs, and takes their size from their slab's size class instead of the size that it writes before each object now.
- The size classes, the slab size and the number of empty slabs kept are settled by measuring the benchmarks in `bench/`.

## Concurrency

- **async/await and an event loop are core features** (Node-like); what is implemented is in [the reference](../reference/functions.md#functions-that-await). The event loop runs on libuv, with sleeps and the programs that `run` starts so far; input and output come onto it next.
- **What awaits**: an operation whose wait has no bound, set by the outside world or by the amount of data, gives a `Promise`: processes, timers, the network, standard input, reading and writing a file's contents, and removing a tree. One that is a single small system call stays synchronous, as `is_file`, `real_path`, `make_dir`, `make_temp_dir` and `rename` do: it is over in microseconds on a local disk, less than handing it to libuv's thread pool takes, and an `await` would spread to every caller, as it cannot be written in a lambda or a lazy comprehension. An asynchronous version can be added where a slow file system, such as a network one, calls for it.
- **`print` does not await**: writes to stdout and stderr are queued in order and go out from the event loop, and the program ends once they have; a failed write is remembered and reported by the exit code, as now (see [std:io](../reference/modules.md#stdio)).
- Parallel computation uses **workers that do not share a heap, with message passing** (Node's worker_threads / the Erlang approach).
- Programs stay single-threaded, so data races do not exist: there is no thread API (to avoid the GIL path of Python and Ruby).

## Open questions

- Whether stack overflow should be an exception that can be caught instead of a panic. That needs the check at function entry described in [internals](../internals.md#stack-overflow).
- Value semantics for arrays (copy-on-write), or detection of modification during iteration.
- Whether the runtime should collect cycles (as Nim's ORC does by trial deletion), to be decided once async/await shows whether the means above keep closure cycles in check.
- How to pass values to workers (candidates: deep copy only + sharing immutable `Binary` / run-time moves like JS transfer).
