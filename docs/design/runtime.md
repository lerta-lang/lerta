# Runtime

## Memory management

- **Reference counting only** (the same policy as Swift's ARC). There is no cycle collector in production.
- `weak!` fields, which throw when read after their object is freed, are implemented: see [the reference](../reference/objects.md#classes-and-structs). Planned: `weak var p: Node?` locals, and a `weak` field of type `T?` that reads as nil once its object is freed, promoted to a strong local when read.
- The specification states that retain/release "may happen on assignment and argument passing". Whatever optimization can remove is removed.
- Immutable data (structs) is recommended (it cannot form cycles).
- The language does not prevent cycles through closures (`@button.listen -> @count += 1`). There are no capture lists. To break a cycle, put the value in a `weak var` local and capture that.
  - The typical form (a closure that captures `this`, held through a field of `this`) gets a compiler warning.
  - Cycles across libraries are left to the leak check of the debug runtime ([internals](../internals.md#leak-checking)).

## Concurrency model

- **Single-threaded.** Data races do not exist by the language specification.
- **async/await and an event loop are core features** from the start (Node-like).
- Parallel computation uses **workers that do not share a heap, with message passing** (Node's worker_threads / the Erlang approach). How values are passed is undecided.
- There is no thread API (to avoid the GIL path of Python and Ruby).
