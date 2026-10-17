# Programs

The planned design of modules, FFI, the standard library and tools.

## C ABI / FFI

- An `extern` declaration may also refer to a C variable.
- Generic externs, `extern lerta_map_remove: <K, V>(Map<K, V>, K) -> void`, for C functions that take a value of any type as a pointer, as an array, a map or a String is. With them, the method `remove`, built into the compiler now (see [internals](../internals.md#builtins)), moves to `std/builtins.lerta`, and so would the properties `length` and `s.binary` with extern properties (see [open questions](#open-questions)); `push`, `pop` and indexing stay built in, since their code depends on the items' kind. Using them in std needs a seed refresh.
- C headers are imported with libclang.
- The C side reaches Lerta's objects through accessors (see [internals](../internals.md#ffi)).
- Decided points:
  - C++ / Rust go through C wrappers.
  - Ownership boundary: when the C side keeps holding a value, it retains it with an explicit API (equivalent to Swift's `Unmanaged.passRetained`).
  - Passing structs by value: initially limited to passing by pointer (ABI classification is postponed).
  - Function-like macros and inline functions cannot be called. Writing a C wrapper function is the escape hatch.

## Standard library

- The rest of JSON, in [std:json](../reference/modules.md#stdjson): the types that it does not convert yet, each an error at the call until it does, as a function, a `Promise`, an `Iter`, an interface or a weak field stays.

  | Lerta | JSON |
  |---|---|
  | `T?` | a field of an optional type may also be missing |
  | tuples | array |
  | `Map<String, V>` | object |
  | classes, structs, anonymous structs | object, a key for each field, whose path is `.name`; a field with a default may be missing, and keys that are no field are ignored. Encoding throws a `JsonError` for an object that holds itself, through any of its parts, naming the path to where it does: `$.children[0].parent: a cycle back to $`; an object reached twice otherwise is written twice. |
  | enums | the member's name, as a string |
  | unions | the member, as it is: decoding takes the member that the JSON's kind of value tells, so the members must differ in it, as `Int \| String` does; members that are all objects are an error |

  - Keys are the field names as written. `encode_json(value, JsonKeys.camel_case)` and `decode_json<T>(text, JsonKeys.camel_case)` write `text_document` as `textDocument`, for formats such as the [LSP](#tools)'s.
  - Unions of objects told apart by a field, as `kind`, and a dynamic JSON value type wait until a program needs them: a message whose fields depend on another field is decoded twice, first as a type with only that field, then as the type it names.
- Random numbers, formatting dates and times, and the network.
- What the [test harness](#tools) needs of the programs it runs and the files it checks:
  - `run` gives the program an input on stdin, captures its stderr as it does its stdout, runs it in a given directory with variables of the environment changed or removed, tells an exit by a signal from an exit status, and can kill the program.
  - In `std:io`: a file's modification time, making a symbolic link, and copying a file.

## Tools

- `.ll`/bitcode output from `lerta build`.
- With `--source-lines` on Windows, a PDB beside the program (CodeView, which LLVM gives for mingw too, and lld writes), so that WinDbg and Visual Studio read the source lines, as gdb and lldb read the DWARF that it holds now.
- LLVM emits objects, and `lld` links them, on all platforms, through a C++ shim (see [internals](../internals.md#interface-with-llvm-planned)).
- `lerta run` running directly with JIT, and `lerta repl`.
- The rest of the style in [`lerta fmt`](../reference/compiler.md): reporting what it cannot fix, such as a name in the wrong case or a line it cannot bring within 100 columns; the rules that change the syntax tree, such as implicit return and the shorthand of named arguments; and, applied only when the file type-checks, the rules that need types, such as whether a `case` handles every member of its subject. The compiler reports only what concerns correctness, such as unused names.
- `lerta fmt` reports each difference under the rule that it breaks, and each run of differing lines apart, as [the reference](../reference/compiler.md#fmt) states: now some are reported under another rule, as the shorthand of `{ x: x }` under **Layout**, and separate runs that differ may be reported as one. The formatter has no options, as it applies the style as written; settings wait for a configuration file (see [open questions](#open-questions)).
- An LSP, `lerta lsp`, a server over stdin and stdout written in Lerta with `std:json` (see [standard library](#standard-library)). It reads a message's `method` and `id` first, then decodes it again as `Request<P>` (a generic struct of `id` and `params: P`) of the params that the method takes. It asks for the whole text on each change (`TextDocumentSyncKind.Full`), so that the changes it decodes are of one shape, and reads of `initialize` only the fields it uses. In order:
  1. Diagnostics, of the program whose entry module is the open file, reported as `lerta build` reports them, without generating code, when a file is opened or changed; and formatting, as `lerta fmt --fix` would write the file.
  2. Hover, giving a node's type, and going to a definition, which need the checker to find a node by its position.
  3. Completion.
- Package management.
- The test harness, `test/`, written in Lerta, so that the tests need no Node.js and the [standard library](#standard-library) is used for real work. The run tests (`run.ts`) move first, needing the least of it, then the command-line checks (`cli.ts`), which then run on Windows too (the bootstrap runs there already: see [platforms](../internals.md#platforms)), and the runtime checks (`runtime.ts`).
  - minilerta builds the harness, as it builds `tools/embed.lerta`, so that a change to `compiler/` cannot break the harness that tests it, least of all into passing every test. minilerta reads `std/` and `runtime/` from the working tree (see [bootstrap](../internals.md#bootstrap)), so a change to them still reaches the harness; it checks itself for that: tests that must fail, by their output, a leak or an abort, must be reported as failed, and the number of tests run must be the number found in the directories.

## Open questions

- How the test harness limits the output of a program it runs: by an argument of `run`, or by itself.
- Whether the runtime checks keep running `script` for a terminal, or `std:process` gives one (a pty).
- Extern properties, `extern lerta_array_length as length: Int` in an extend, which read a property by calling a C function with the receiver. They would move `length` and `s.binary` to std, but they are getters written in C, which [philosophy](../philosophy.md#non-goals) leaves out; allowing them only in `std:` modules, as a builtin special case, keeps that for users.
- The ABI of `String` at the FFI boundary (pass as a 16-byte value, or box it in the heap representation; decide when small strings become immediate values).
- What a C function declared to return `Float` does when it returns a value that is not finite: throw at the boundary, as an operation does, or leave it to the caller.
- How to keep the repository small as the seed is refreshed (`seed/minilerta.ll`, see [bootstrap](../internals.md#bootstrap)): refreshing only at milestones, or keeping the seed outside the history, as with Git LFS or as a release asset.
- How to hold type information for separate compilation (interface files).
- The package management approach (npm style vs Go's minimal version selection).
- The formatter's configuration file, such as the line length. A file holding one bracketless literal, checked as the named arguments of a configuration type, reads like YAML without being run; decide it with the package manifest, which has the same need.
