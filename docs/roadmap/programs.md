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

- Writes become asynchronous with the event loop (see [concurrency](runtime.md#concurrency)).
- JSON, where JSON `null` is Lerta `nil`.

## Tools

- `.ll`/bitcode output from `lerta build`.
- `lerta run` running directly with JIT, and `lerta repl`.
- A formatter (like gofmt) is provided from day one. It applies what the [style](../reference/style.md) can fix mechanically, such as the commas at line ends, the brackets a list can do without and where long lists break.
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
