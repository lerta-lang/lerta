# Programs

The planned design of modules, FFI, the standard library and tools.

## Modules

- `import mod from 'module'` gives access as `mod.<exported_name>`.

## C ABI / FFI

- An `extern` declaration may also refer to a C variable.
- Generic externs, `extern lerta_array_length: <T>(Array<T>) -> Int`, for C functions that take a value of any type as a pointer, as an array, a map or a String is. With them, `length`, `keys`, `remove` and `s.binary`, built into the compiler now (see [internals](../internals.md#builtins)), move to `std/builtins.lerta`; `push`, `pop` and indexing stay built in, since their code depends on the items' kind. Using them in std needs a seed refresh, best taken with generic classes, which move `Iter<T>` there too (see [Iterables](language.md#iterables)).
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
- A formatter (like gofmt) is provided from day one.
- An LSP.
- Package management.
- Testing the compiler itself on Windows (its programs are built and run there already: see [platforms](../internals.md#platforms)).

## Open questions

- Sorting arrays (`compiler/sort.lerta` sorts by hand for now).
- The ABI of `String` at the FFI boundary (pass as a 16-byte value, or box it in the heap representation; decide when small strings become immediate values).
- How to trigger serialization code generation (an annotation on the type, or automatic generation from calls such as `json.decode<T>`).
- How to hold type information for separate compilation (interface files).
- The package management approach (npm style vs Go's minimal version selection).
