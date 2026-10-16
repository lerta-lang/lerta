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

For now, cycles stay uncollected ([objects](../reference/objects.md#classes-and-structs)). The plan is to make them hard to write, and to report the ones that are written:

- Cycles across libraries are left to the leak check of the debug runtime ([internals](../internals.md#leak-checking)), which reports the cycles that remain at exit by their types, traversing the objects still alive.
- The warning of a literal that captures `@` and is stored where `@` holds it ([errors](../reference/errors.md#cycles)) extends, with input and output, to a literal given to a method that keeps its argument where its object holds it, as `@button.listen(-> @count += 1)` does if `listen` stores it: a method's parameters that reach a field or a collection are found once, as the method is checked. Callbacks kept by C functions need a way to say so.

### Reference count operations

Every expression of a reference type yields an owned reference for now ([internals](../internals.md#memory-management)), so passing a local to a call retains and releases it around the call. The plan is to borrow where the value cannot go away meanwhile, as a `const` local or a parameter passed as an argument, and emit no retain and release there. In the compiler's front end, `lerta_retain` and `lerta_release` take about a third of the time.

First, the operations that this would remove are counted in the generated code, to see whether the gain is worth the change to the ownership of values in codegen.

### Allocation

The size classes of the allocator ([internals](../internals.md#allocation)), the limits of 256 bytes and 16 KiB, and the number of empty slabs kept are settled by measuring the benchmarks in `bench/` and the compiler's own build.

## Concurrency

- **async/await and an event loop are core features** (Node-like); what is implemented is in [the reference](../reference/functions.md#functions-that-await). The event loop runs on libuv, with sleeps and the programs that `run` starts so far; input and output come onto it next.
- **What awaits**: an operation whose wait has no bound, set by the outside world or by the amount of data, gives a `Promise`: processes, timers, the network, standard input, reading and writing a file's contents, and removing a tree. One that is a single small system call stays synchronous, as `is_file`, `real_path`, `make_dir`, `make_temp_dir` and `rename` do: it is over in microseconds on a local disk, less than handing it to libuv's thread pool takes, and an `await` would spread to every caller, as it cannot be written in a lazy comprehension. An asynchronous version can be added where a slow file system, such as a network one, calls for it.
- **`print` and `print_error` write at once**: they write to stdout and stderr synchronously, without a buffer, so that what they print is out even if a long computation follows. Before writing, they write out what `stdout` and `stderr` hold in their buffers, so that the output keeps its order. A failed write is remembered and reported by the exit code, as now (see [std:io](../reference/modules.md#stdio)).
- **`stdout` and `stderr` buffer and await**: `write`, `write_binary` and `flush` give a `Promise`. A write goes into a buffer, to a terminal or not, which is written out when it is full, on `flush`, before a `print` or `print_error`, and at exit; a write that fills the buffer resolves once it is written out, so a fast writer waits for a slow reader. A failed write out rejects the `Promise`; one at exit is reported by the exit code. SIGPIPE ends the program as now.
- Parallel computation uses **workers that do not share a heap, with message passing** (Node's worker_threads / the Erlang approach).
- Programs stay single-threaded (see [philosophy](../philosophy.md#safety)), with no thread API, to avoid the GIL path of Python and Ruby.

## Open questions

- Whether stack overflow should be an exception that can be caught instead of a panic. That needs the check at function entry described in [internals](../internals.md#stack-overflow).
- Value semantics for arrays (copy-on-write), or detection of modification during iteration.
- Whether the runtime should collect cycles (as Nim's ORC does by trial deletion), to be decided once async/await shows whether the means above keep closure cycles in check.
- How to pass values to workers (candidates: deep copy only + sharing immutable `Binary` / run-time moves like JS transfer).
