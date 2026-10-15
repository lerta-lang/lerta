# Programs

The planned design of modules, FFI, the standard library and tools.

## Modules

- `import 'module' as mod` gives access as `mod.<exported_name>`, in values and in types (`x: mod.Point`). `mod` is not a value: it can only be followed by `.name`. This is not the `import *` that [philosophy](../philosophy.md#non-goals) leaves out, which brings the names in unqualified; the design is open (see below).

## C ABI / FFI

- An `extern` declaration may also refer to a C variable.
- Generic externs, `extern lerta_map_keys: <K, V>(Map<K, V>) -> Array<K>`, for C functions that take a value of any type as a pointer, as an array, a map or a String is. With them, the methods `keys` and `remove`, built into the compiler now (see [internals](../internals.md#builtins)), move to `std/builtins.lerta`, and so would the properties `length` and `s.binary` with extern properties (see [open questions](#open-questions)); `push`, `pop` and indexing stay built in, since their code depends on the items' kind. Using them in std needs a seed refresh.
- C headers are imported with libclang.
- The C side reaches Lerta's objects through accessors (see [internals](../internals.md#ffi)).
- Decided points:
  - C++ / Rust go through C wrappers.
  - Ownership boundary: when the C side keeps holding a value, it retains it with an explicit API (equivalent to Swift's `Unmanaged.passRetained`).
  - Passing structs by value: initially limited to passing by pointer (ABI classification is postponed).
  - Function-like macros and inline functions cannot be called. Writing a C wrapper function is the escape hatch.

## Standard library

- `read_file`, `write_file` and `remove_tree` give a `Promise`, and stdout and stderr are written from the event loop, as [concurrency](runtime.md#concurrency) has it.
- JSON, where JSON `null` is Lerta `nil`.
- `x.to_fixed(digits)` of a `Float`: the value rounded to that many digits after the point, as JavaScript's `toFixed` writes it, for tables of numbers.

## Tools

- `.ll`/bitcode output from `lerta build`.
- An optimized build keeps what it has optimized of each module in the cache, and optimizes again only the modules that have changed and those that inline from them (see [internals](../internals.md#per-module-output-planned)).
- `lerta run` running directly with JIT, and `lerta repl`.
- A formatter, `lerta fmt`, provided from day one, holds the whole [style](../reference/style.md): it fixes what can be fixed mechanically, such as the commas at line ends, the brackets a list can do without and where long lists break, and reports what cannot, such as a name in the wrong case or a line it cannot bring within 100 columns. The compiler reports only what concerns correctness, such as unused names.
  - By default it only checks: it reports each place that breaks the style as a compile error does, `<path>:<line>:<column>: <message> (<rules>)`, with each rule that decides the place named by its bold label in the style, separated by commas, and fails if there is any. `--fix` writes the fixes. Its arguments are files and directories, whose `.lerta` files it takes, skipping the directories inside them whose names start with `.`.
  - It has no options: it applies the style as written. Settings wait for a configuration file (see [open questions](#open-questions)).
  - The rules that need types, such as whether a `case` handles every member of its subject or whether a return type can be inferred, are applied only when the file type-checks; the others work on any code that parses.
  - The lexer gives the comments apart from the tokens, by position and whether each is on a line of its own; the formatter reads their text and the blank lines from the source, and puts a comment back by the tokens around it in the source that the output keeps: one that ends a line after the last of them on that line, or before the next one if none is, and one on a line of its own before the next one. A node that the formatter moves keeps its position, so its comments move with it.
  - It prints the whole file again from the AST, laid out by a pretty printer that takes one of two forms of a part when the first does not fit, and compares that with the source: each part that the style decides is marked with its rule, and a place that differs is reported with the rules of the parts there. What the AST drops and the style does not decide is read from the source by position: the spelling of a literal, and the names of a destructuring, which the AST keeps only for the parts that are not `_` (`const (a, _) = t`). Before writing, the formatter parses its output again and refuses if the AST differs from the one it rewrote.
- An LSP.
- Package management.
- Running the compiler's command-line checks (`test/cli.ts`) on Windows (the bootstrap runs there already: see [platforms](../internals.md#platforms)).

## Open questions

- Extern properties, `extern lerta_array_length as length: Int` in an extend, which read a property by calling a C function with the receiver. They would move `length` and `s.binary` to std, but they are getters written in C, which [philosophy](../philosophy.md#non-goals) leaves out; allowing them only in `std:` modules, as a builtin special case, keeps that for users.
- The ABI of `String` at the FFI boundary (pass as a 16-byte value, or box it in the heap representation; decide when small strings become immediate values).
- How to trigger serialization code generation (an annotation on the type, or automatic generation from calls such as `json.decode<T>`).
- How to hold type information for separate compilation (interface files).
- The package management approach (npm style vs Go's minimal version selection).
- How `import 'module' as mod` resolves `mod.name` (in the parser as a qualified name, or in the checker as a member of a module value), and whether philosophy's `import *` should then read as the unqualified form only.
- The formatter's configuration file, such as the line length. A file holding one bracketless literal, checked as the named arguments of a configuration type, reads like YAML without being run; decide it with the package manifest, which has the same need.
