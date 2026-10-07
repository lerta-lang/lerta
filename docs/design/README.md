# Language design (planned)

This directory holds the planned design of the language as the user sees it. None of it is implemented yet.

When a feature is implemented, its description moves to [../reference/](../reference/README.md) and is removed from here, leaving a pointer.

| File | Topic |
|---|---|
| [syntax.md](syntax.md) | Lexical rules, declarations, multi-line literals, calls without parentheses, operator precedence |
| [control-flow.md](control-flow.md) | Statements and expressions, `void`/`never`, conditionals, loops, comprehensions, `case` |
| [types.md](types.md) | Type system and numeric types |
| [strings.md](strings.md) | Strings, `Binary`, regular expressions |
| [objects.md](objects.md) | Classes, structs, interfaces |
| [operators.md](operators.md) | Operator overloading |
| [errors.md](errors.md) | Safety, discarded values, exceptions, panics |
| [runtime.md](runtime.md) | Memory management and concurrency |
| [programs.md](programs.md) | Modules, program structure, FFI, tools |
