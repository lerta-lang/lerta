# Runtime

The planned design of safety, errors and exceptions, memory management, concurrency and platforms.

## Safety

The definition of safety is in [philosophy](../philosophy.md#safety). Planned:

- FFI and raw pointer operations only inside `unsafe` blocks.
- A panic prints a stack trace besides its message, perhaps through a **frame record** per function, linked to a global `current_frame` (the LLVM shadow stack approach). Exceptions need none: their traces are made as they unwind ([internals](../internals/execution.md#exception-traces)).

## Index checks

Each read or write of an array's item checks its index against the length (`lerta_array_checked_items`, inlined).

### Checks in loops

A loop whose bounds already keep the index in range checks it again each time.

- **Cost.** `bench/sieve` indexes `Array(n, false)` by `i` of `for i in 2...n` and by `j` of `while j < n`. It takes 0.21 s with the checks and 0.187 s with every check removed by hand, as long as Go's 0.188 s, which proves them in range itself.
- **Tried:**
  - Telling LLVM that the length is `n` right after `Array(n, v)` (`llvm.assume`) did not let it drop them: it compared the outer loop's index with `n` instead, but read the length again in the inner loop.
  - Checking the index against `n` itself, as the compiler could for an array that is only indexed and never passed or grown, took 1% off, where removing the checks took 8% (both against the same program built without ThinLTO). LLVM then drops the check of `i`, but not that of `j`: `j` starts at `i * i` and grows by `i` through checked operations, so LLVM cannot tell that it is not negative.
- **Needed.** The compiler must know that the array's length does not change while the loop runs and that the index stays in range, as a `for`'s range shows, and a `while`'s condition does with a variable that only grows from a value in range.
- **In the compiler.** Its own `dump-llvm`, built with `-O` and without the memory checks, ran 0.9% fewer instructions with every check of an array's index removed, and 3.0% fewer with those of a `Binary`'s index removed too, in about the same time.
- **Signed checks.** Checking a `Binary`'s index as two signed comparisons, rather than one unsigned, took 0.85% of those instructions off, as LLVM then drops the comparison with the length that a loop's condition has made. The same for an array's left the compiler as it was and made `bench/sieve` 8% slower, so an array's stays unsigned.

### Items of top-level arrays

An inner loop that indexes an array that a top-level value holds, as `bodies[j]` in `bench/nbody`, reads the array's items again each time.

- Why: `lerta_array_checked_items` reads them only for an index in range, and LLVM does not take that read out of the loop without knowing that the array's memory may be read before the check.
- Giving the load of the array `!dereferenceable` and `!align` took it out, and 1.1% of nbody's instructions off. But the generated IR is the same for every target, while the size of `LertaArray` is not (48 bytes on 64-bit targets, 36 on i686).
- Needed: the compiler knows the target's layout, or the runtime reads the items before the check in a way that LLVM does not sink back.

### Optional reads

A loop that reads a `Binary` through `get` and `?.`, `end += 1 while bytes.get(end)?.is_digit()`, should cost what one written with the check, `end < bytes.length and bytes[end].is_digit()`, does. In std:json's `JsonReader`, which reads digits and spaces so, decoding 20,000 objects with spaces between their parts ran 4% more instructions than with the check, which the loops had before.

## Discarded values

These apply when a value in statement position is not captured, beyond [the reference](../reference/errors.md#discarded-values).

- A method of an immutable type (`String`, `Binary`) that returns a new value (`s.trim()`) → **error**. Why: the type is immutable, so its type shows that discarding it does nothing.
- A `must_use` annotation makes discarding the result of a call to a particular function an error.

## Exceptions

What is implemented, `throw` of `Error` values and `try`/`catch`/`finally`, is in [the reference](../reference/errors.md#exceptions). Planned:

- No `throws` annotation is needed; if written, it is type-checked. No `try` is attached to calls (as in Swift).
- For servers, exceptions are caught at the task boundary of the event loop, and only that task is discarded.

## Memory management

For now, cycles stay uncollected ([objects](../reference/objects.md#reference-counting)). The debug runtime reports the objects that only cycles hold, by their types ([the reference](../reference/compiler.md#build)), which is left to catch the cycles across libraries. The plan is to make cycles hard to write:

- The warning of a literal that captures `@` and is stored where `@` holds it ([errors](../reference/errors.md#cycles)) extends, with input and output, to a literal given to a method that keeps its argument where its object holds it, as `@button.listen(-> @count += 1)` does if `listen` stores it.
  - A method's parameters that reach a field or a collection are found once, as the method is checked.
  - Callbacks kept by C functions need a way to say so.

### Reference count operations

Every expression of a reference type yields an owned reference for now, except the values that [internals](../internals/memory.md) lists as borrowed, such as a `const` local passed as an argument. So passing another value to a call, as a captured or top-level `var` or a field read (`f(a.b)`), retains and releases it around the call. The plan is to borrow those too where the value cannot go away meanwhile, and emit no retain and release there.

Field reads are borrowed now where nothing runs while they are used ([internals](../internals/memory.md)), which took 5% of the instructions of the compiler's own `dump-llvm`.

- **First count.** Counted at run time there before, the pairs left were mostly of field reads as an argument or the object of a call, 28M, against 46M that the borrowing in place removed. Borrowing those needs to know that the call cannot replace the field. Since borrowed:
  - fields that hold the same value as long as their objects live (0.4%);
  - fields that no assignment changes (3.3%);
  - top-level `const`s read from functions (1.5% more);
  - `var`s, 1.5M, except those that a closure captures, that are top-level or that what is evaluated meanwhile assigns.
- **Second count,** after fields that no assignment changes were borrowed. The owned values that a borrowing consumer takes:

  | Kind | Count | Notes |
  |---|---|---|
  | Top-level `const`s | 9.9M | Borrowed since |
  | Results of calls | 5.5M | New values |
  | Indexes | 4.0M | 2.4M in place (`xs[i].name`), 1.6M as an argument or the object of a call |
  | Members that are no plain field, such as properties | 3.1M | |
  | String literals | 2.3M | |
  | Fields that an assignment changes | 0.4M | |

- Only a pair with a call between its retain and its release costs: with the runtime inlined, LLVM drops one with none between, and folds the release of a literal, which is a constant. So borrowing the items of indexes in place took nothing measurable (0.1%), and the top-level `const`s, many of them literals, took less than their count.
- **Left:** the indexes and the members passed to calls, which needs to know what the call can change.

### Objects on the stack

The closure of a function literal declared as a local that only its own function calls is on the stack, immortal, already ([internals](../internals/representation.md#objects)).

- **Plan.** The same for any object that a local holds and that never leaves its function: a class or struct object, a tuple, an anonymous struct, or an array of a small length, as the digits that `Int.to_string` builds.
- As for closures, an object held weakly, or kept across a `yield` or an `await`, stays on the heap.
- **A first try** (branch `stack-arrays`) put on the stack the arrays, structs without a `deinit`, anonymous structs and tuples of `const` locals that an escape analysis across calls showed never leave their function. It went in two steps: the objects alone (its first commit), then also an array's first 128 bytes of items.
  - Against the same compiler without it, `bench/word_count` ran 4% and then 6% fewer instructions, but no faster in time beyond the noise.
  - The compiler's own `dump-llvm` ran about 1% more instructions in the same time, for the analysis and a second constructor for every struct.
  - It was set aside: one allocation saved per word does not show in time, where small strings, saving two, made `word_count` 21% faster ([strings](strings.md#small-strings)).

### Allocation

The size classes of the allocator ([internals](../internals/memory.md#allocation)), the limits of 256 bytes and 16 KiB, and the number of empty slabs kept are settled by measuring the benchmarks in `bench/` and the compiler's own build.

## Concurrency

- **async/await and an event loop are core features** (Node-like); what is implemented is in [the reference](../reference/functions.md#functions-that-await).
  - The event loop runs on libuv so far for: sleeps, the programs that `run` starts, the writes of `stdout` and `stderr`, reading `stdin`, reading, writing and removing files, and the network ([std:net](../reference/std.md#stdnet)).
- **What awaits.** An operation whose wait has no bound, set by the outside world or by the amount of data, gives a `Promise`: processes, timers, the network, standard input, reading, writing and copying a file's contents, and removing a tree.
  - One that is a single small system call stays synchronous: `is_file`, `stat`, `real_path`, `make_dir`, `make_temp_dir`, `make_link` and `rename`.
  - Why: it is over in microseconds on a local disk, less than handing it to libuv's thread pool takes, and an `await` would spread to every caller, as it cannot be written in a lazy comprehension.
  - An asynchronous version can be added where a slow file system, such as a network one, calls for it.
- **Parallelism** uses **workers that do not share a heap, with message passing** (Node's worker_threads / the Erlang approach). Programs stay single-threaded, with no thread API (see [philosophy](../philosophy.md#non-goals)). Why: to avoid the GIL path of Python and Ruby.
- **Event loop queues.** The queues of the tasks that are ready and of the writers that wait for the output's buffer (`LertaQueue` in `runtime/internal.h`) move their items to the front whenever they are full and the front has room. So a queue kept just under its capacity moves them all at almost every push. A queue should instead:
  - move them only once the front holds at least as many places as the items, and grow otherwise;
  - start again at the front once it is empty.
- **Task errors.** An error of a task that `spawn` of [std:async](../reference/std.md#stdasync) starts is to end at its task (see [exceptions](#exceptions)), rather than ending the program as now. Until then, std:http catches its tasks' errors itself.

## Platforms

- Microcontrollers as targets (STM32 / Cortex-M, ESP32-C3/C6 / RISC-V; Xtensa-based chips after upstream LLVM support matures).
  - `Int` stays fixed at 64 bits (TinyGo's environment-dependent `int` is not adopted). Hot spots use `Int32` explicitly.
  - The [event loop](../internals/iteration.md#functions-that-await) runs there on an interrupt-driven scheduler or FreeRTOS/Zephyr, in place of the runtime's files that use libuv's loop.
  - The platform functions are replaced, as the allocator's regions are by a static heap (see [allocation](../internals/memory.md#allocation)). The rest of the runtime needs only what [the runtime rules](../internals/architecture.md#runtime-rules) allow of the C library.
  - Beware of code bloat from monomorphization. Remedies when needed: merging instances with identical machine code at link time (LLVM mergefunc, lld ICF), and a build option to switch to dispatch through interfaces.
  - Where there is no guard page, the remaining stack is checked at function entry (the Go approach).

## Open questions

- Whether stack overflow should be an exception that can be caught, instead of a panic. That needs the remaining stack checked at function entry instead of [the guard page](../internals/execution.md#stack-overflow), as on the targets without one, such as [microcontrollers](#platforms). Catching it then works like any throw, since the handler runs after unwinding.
- Value semantics for arrays (copy-on-write), or detection of modification during iteration.
- Whether the runtime should collect cycles (as Nim's ORC does by trial deletion). It is decided by the leak check's report of cycles on a few event-driven programs, of the size of `examples/editor.lerta` or larger, written for it. Decide before the APIs that keep callbacks are designed, as they set their shape, rather than after async/await is complete.
- How to pass values to workers (candidates: deep copy only + sharing immutable `Binary` / run-time moves like JS transfer).
