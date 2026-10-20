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

- No `throws` annotation is needed (if written, it is type-checked). There is no `try` attached to calls (as in Swift).
- For servers, exceptions are caught at the task boundary of the event loop and only that task is discarded.

## Memory management

For now, cycles stay uncollected ([objects](../reference/objects.md#classes-and-structs)), and the debug runtime reports the objects that only cycles hold, by their types ([the reference](../reference/compiler.md#build)), which is left to catch the cycles across libraries. The plan is to make them hard to write:

- The warning of a literal that captures `@` and is stored where `@` holds it ([errors](../reference/errors.md#cycles)) extends, with input and output, to a literal given to a method that keeps its argument where its object holds it, as `@button.listen(-> @count += 1)` does if `listen` stores it: a method's parameters that reach a field or a collection are found once, as the method is checked. Callbacks kept by C functions need a way to say so.

### Reference count operations

Every expression of a reference type yields an owned reference for now ([internals](../internals.md#memory-management)), so passing a local to a call retains and releases it around the call. The plan is to borrow where the value cannot go away meanwhile, as a `const` local or a parameter passed as an argument, and emit no retain and release there. In the compiler's front end, `lerta_retain` and `lerta_release` take about a third of the time.

First, the operations that this would remove are counted in the generated code, to see whether the gain is worth the change to the ownership of values in codegen.

### Allocation

The size classes of the allocator ([internals](../internals.md#allocation)), the limits of 256 bytes and 16 KiB, and the number of empty slabs kept are settled by measuring the benchmarks in `bench/` and the compiler's own build.

## Concurrency

- **async/await and an event loop are core features** (Node-like); what is implemented is in [the reference](../reference/functions.md#functions-that-await). The event loop runs on libuv, with sleeps, the programs that `run` starts, the writes of `stdout` and `stderr`, the reading of `stdin`, and the reading, writing and removal of files so far; the network comes onto it next.
- **What awaits**: an operation whose wait has no bound, set by the outside world or by the amount of data, gives a `Promise`: processes, timers, the network, standard input, reading, writing and copying a file's contents, and removing a tree. One that is a single small system call stays synchronous, as `is_file`, `stat`, `real_path`, `make_dir`, `make_temp_dir`, `make_link` and `rename` do: it is over in microseconds on a local disk, less than handing it to libuv's thread pool takes, and an `await` would spread to every caller, as it cannot be written in a lazy comprehension. An asynchronous version can be added where a slow file system, such as a network one, calls for it.
- Parallel computation uses **workers that do not share a heap, with message passing** (Node's worker_threads / the Erlang approach).
- Programs stay single-threaded (see [philosophy](../philosophy.md#safety)), with no thread API, to avoid the GIL path of Python and Ruby.

## Open questions

- Whether stack overflow should be an exception that can be caught instead of a panic. That needs the check at function entry described in [internals](../internals.md#stack-overflow).
- Value semantics for arrays (copy-on-write), or detection of modification during iteration.
- Whether the runtime should collect cycles (as Nim's ORC does by trial deletion). It is decided by the leak check's report of cycles on a few programs driven by events, of the size of `examples/editor.lerta` or larger, written for it, before the APIs that keep callbacks, as those of the network on the event loop, are designed, which set their shape, rather than after async/await is complete.
- How to pass values to workers (candidates: deep copy only + sharing immutable `Binary` / run-time moves like JS transfer).
