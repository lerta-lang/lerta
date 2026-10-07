# Programs

## Modules

Named imports from the standard modules are implemented: see [the reference](../reference/modules.md).

- **ESM style** (`import`/`export`). A file is a module.
- Paths: `'./util'` and `'../lib/x'` are relative to the importing file (`./`/`../` required, the extension `.lerta` omitted, no `index` resolution for directories). `'std:io'` is a standard module. Bare names like `'util'` are reserved for future packages.
- There are builtins (no import needed) and standard modules (`'std:...'`). For what each holds in stage0, see [the roadmap](../roadmap.md#standard-library-layout-in-stage0).

  - `stdout`/`stderr` are values of type `Writer` (`write(s: String)`, `write_binary(b: Binary)`). `print(x: Stringable)` (implemented for `String`, `Int`, `UInt8` and `Bool`: see [the reference](../reference/builtins.md)) writes `x.to_string()` and a newline to `stdout` (once user-defined generics arrive, it changes to `<T: Stringable>(x: T)` and becomes a direct call through monomorphization).
  - `stdout` is buffered and flushed automatically at exit (including `exit`); `flush()` also exists. `stderr` is not buffered (so messages just before an abnormal exit are not lost).
- There is no `main` function. A program runs the top-level code of the entry module from top to bottom.
- Order of top-level declarations:
  - Type declarations (`struct`/`class`/`type`/`interface`) and `const` whose value is a function literal do not depend on order (they can be referenced from anywhere in the module; mutual recursion and self-referential types can be written).
  - Other `const`/`var` and statements run from top to bottom.
  - Reading a value before it is initialized: a direct reference (`const a = b` where `b` comes later) is a compile error. A reference through a function is checked at run time and throws (see [internals](../internals.md#modules)).
- The top level of an imported module runs exactly once, in dependency order (same as ESM; exported values may be built with statements).
  - Circular imports are allowed. Reading an uninitialized value during the cycle throws via the run-time check above.
- There is **no** `import *`.
- There is **no** `export default` (named exports only).
- `import { <exported_name> } from 'module'` gives access to individual names.
- `import mod from 'module'` gives access as `mod.<exported_name>`.
- `import { <exported_name> as <alias> } from 'module'` gives access under an alias.

## C ABI / FFI

- An `extern` declaration refers to a C function or variable. Its type is written as an ordinary function type (`extern lerta_write: (Int, String) -> Int`). The name is used as the C symbol name as is.
- The C side handles Lerta's object representation directly. For the representation passed, the ownership convention and the accessors, see [internals](../internals.md#ffi).
- FFI is a future extension. Decided points:
  - **C ABI only.** C++ / Rust go through C wrappers.
  - Ownership boundary: when the C side keeps holding a value, it retains it with an explicit API (equivalent to Swift's `Unmanaged.passRetained`).
  - Passing structs by value: initially limited to passing by pointer (ABI classification is postponed).
  - Function-like macros and inline functions cannot be called. Writing a C wrapper function is the escape hatch.

## Tools

- A formatter (like gofmt) is provided from day one.
- Commands: `lerta build` (produces an executable; optionally outputs `.ll`/bitcode), `lerta run` (runs directly with JIT), `lerta repl`.
