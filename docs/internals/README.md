# Internals

This describes the implementation's design. The planned design is in [the roadmap](../roadmap/README.md); behavior that programs see is in [the reference](../reference/README.md).

| Page | Topic |
|---|---|
| [Architecture](architecture.md) | The parts of the compiler and how they fit, the per-module output and the cache, the runtime rules and the bootstrap |
| [Compiler](compiler.md) | Modules, generics, defaults, the formatter and the language server |
| [Execution model](execution.md) | The execution model: exceptions, their traces and stack overflow |
| [Memory management](memory.md) | Reference counts, object headers, weak references, ownership and borrowing, leak checking, allocation and alias analysis |
| [Representation](representation.md) | How values are represented: objects, interfaces, the builtin types, floats, maps, strings and FFI |
| [Iteration and awaiting](iteration.md) | Iters, functions that yield, fused loops, inlined methods and functions that await |
| [llit](llit.md) | llit, the text of data written as Lerta literals that the tools read |
| [Input, output and platforms](platforms.md) | Output, files, processes and the network, the platform functions, Windows and libuv |
