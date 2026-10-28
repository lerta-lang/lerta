# Language reference

This reference documents only implemented behavior. The planned design of what is not implemented yet is in [the roadmap](../roadmap/README.md).

| File | Topic |
|---|---|
| [syntax.md](syntax.md) | Lexical rules, indentation, brackets, declarations, assignment, statements, calls, how types are written, operators and keywords |
| [types.md](types.md) | Type names, the builtin types and their operations, optional values, unions, enums, anonymous structs and tuples |
| [control-flow.md](control-flow.md) | Blocks, `if`, `while`, `then`/`else`, `for`, ranges, comprehensions and `case` |
| [functions.md](functions.md) | Functions, their parameters, top-level values, function values and literals, functions that yield or await, cancellation, generic functions and C functions |
| [objects.md](objects.md) | Classes and structs (members, construction, mutability, reference counting, equality and operators), `deinit`, `extend` and interfaces |
| [errors.md](errors.md) | Exceptions, panics, discarded values, unused names, unreachable code and cycles |
| [builtins.md](builtins.md) | Builtin functions, the builtin interfaces, `INT_MIN` and `INT_MAX`, and the methods of the builtin types |
| [modules.md](modules.md) | Imports, exports, top-level code and import cycles |
| [std.md](std.md) | The standard modules |
| [compiler.md](compiler.md) | The commands (`build`, `run`, `fmt`, `lsp` and the dumps), the cache and diagnostics |
| [style.md](style.md) | Coding conventions for Lerta code |
