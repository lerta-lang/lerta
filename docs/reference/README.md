# Language reference

This reference documents only implemented behavior. The planned design of what is not implemented yet is in [the roadmap](../roadmap/README.md).

| Page | Topic |
|---|---|
| [Syntax](syntax.md) | Lexical rules, indentation, brackets, declarations, assignment, statements, calls, how types are written, operators and keywords |
| [Types](types.md) | Type names, the builtin types and their operations, optional values, unions, enums, anonymous structs and tuples |
| [Control flow](control-flow.md) | Blocks, `if`, `while`, `then`/`else`, `for`, ranges, comprehensions and `case` |
| [Functions](functions.md) | Functions, their parameters, top-level values, function values and literals, functions that yield or await, cancellation, signals, generic functions and C functions |
| [Objects](objects.md) | Classes and structs (members, construction, mutability, reference counting, equality and operators), `deinit`, `extend` and interfaces |
| [Errors](errors.md) | Exceptions, panics, discarded values, unused names, unreachable code and cycles |
| [Builtins](builtins.md) | Builtin functions, the builtin interfaces, `INT_MIN` and `INT_MAX`, and the methods of the builtin types |
| [Modules](modules.md) | Imports, exports, top-level code and import cycles |
| [Standard modules](std.md) | The `std:` modules, such as those of arguments, JSON, HTTP, files, processes, the network and time |
| [Compiler](compiler.md) | The commands (`build`, `run`, `fmt`, `lsp` and the dumps), the cache and diagnostics |
| [Style](style.md) | Coding conventions for Lerta code |
