# Programs

## Modules

Named imports, with `as`, from the standard modules and from files, `import 'module'`, exports, circular imports, and the order in which modules and top-level code run are implemented: see [the reference](../reference/modules.md). Why: ESM style, so there is no `import *` and no `export default` (see [philosophy](../philosophy.md#non-goals)); paths need `./` or `../` and have no `index` resolution for directories; a reference to a top-level value through a function is checked at run time, so that functions can be declared in any order. Planned:

- `import mod from 'module'` gives access as `mod.<exported_name>`.

## C ABI / FFI

- `extern` declarations of C functions are implemented: see [the reference](../reference/functions.md#c-functions). Planned beyond that:
- An `extern` declaration may also refer to a C variable.
- The C side handles Lerta's object representation directly. For the representation passed, the ownership convention and the accessors, see [internals](../internals.md#ffi).
- FFI is a future extension. Decided points:
  - **C ABI only.** C++ / Rust go through C wrappers.
  - Ownership boundary: when the C side keeps holding a value, it retains it with an explicit API (equivalent to Swift's `Unmanaged.passRetained`).
  - Passing structs by value: initially limited to passing by pointer (ABI classification is postponed).
  - Function-like macros and inline functions cannot be called. Writing a C wrapper function is the escape hatch.

## Tools

- `lerta build` is implemented: see [the reference](../reference/compiler.md). Planned: bitcode output, `lerta run` (runs directly with JIT) and `lerta repl`.
- A formatter (like gofmt) is provided from day one.
