# Internals

This describes the implementation's design. The planned design is in [the roadmap](../roadmap/README.md); behavior that programs see is in [the reference](../reference/README.md).

| File | Topic |
|---|---|
| [architecture.md](architecture.md) | The parts of the compiler and how they fit, the per-module output and the cache, the runtime rules and the bootstrap |
| [compiler.md](compiler.md) | Modules, generics, defaults, the formatter and the language server |
| [execution.md](execution.md) | The execution model: exceptions, their traces and stack overflow |
| [memory.md](memory.md) | Reference counts, object headers, weak references, ownership and borrowing, leak checking, allocation and alias analysis |
| [representation.md](representation.md) | How values are represented: objects, interfaces, the builtin types, floats, maps, strings and FFI |
| [iteration.md](iteration.md) | Iters, functions that yield, fused loops, inlined methods and functions that await |
| [platforms.md](platforms.md) | Output, files, processes and the network, the platform functions, Windows and libuv |
