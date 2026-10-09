# Language design (planned)

This directory holds the planned design of the language as the user sees it. What is implemented has moved out of it.

When a feature is implemented, its description moves to [../reference/](../reference/README.md) and is removed from here, leaving a pointer.

| File | Topic |
|---|---|
| [syntax.md](syntax.md) | Multi-line strings, declarations, multi-line literals, calls without parentheses, `?.` |
| [control-flow.md](control-flow.md) | `if`/`else` with a value, `?.`, narrowing a `var`, `never`, `Range`, lazy methods, `Iterable<T>` |
| [types.md](types.md) | Type system and numeric types |
| [strings.md](strings.md) | Strings, `Binary`, regular expressions |
| [objects.md](objects.md) | Classes, structs, interfaces |
| [operators.md](operators.md) | Operator overloading |
| [errors.md](errors.md) | Safety, discarded values, exceptions, panics |
| [runtime.md](runtime.md) | Memory management and concurrency |
| [programs.md](programs.md) | Modules, FFI, tools |
