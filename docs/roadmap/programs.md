# Programs

The planned design of modules, FFI, the standard library and tools.

## C ABI / FFI

- **`Int?` across the ABI.** An extern takes and returns no `Int?` now. As a C struct of a `bool` and an `int64_t`, it would be passed by a pointer to a copy on 64-bit Windows, and returned through a pointer to a place that the caller gives on 64-bit Windows and on 32-bit x86, which target-independent IR cannot write. So std has two externs where one would give `Int?`, as for `to_int`.
- **C variables.** An `extern` declaration may also refer to a C variable.
- **Generic externs,** `extern lerta_map_remove: <K, V>(Map<K, V>, K) -> void`, for C functions that take a value of any type as a pointer, as an array, a map or a String is.
  - With them, the method `remove`, built into the compiler now (see [internals](../internals/representation.md#builtins)), moves to `std/builtins/`, and so would the properties `length` and `s.binary` with extern properties (see [open questions](#open-questions)).
  - `push`, `pop` and indexing stay built in, since their code depends on the items' kind.
  - Using them in std needs a seed refresh.
- **Tuple results.** An extern may return a tuple or an anonymous struct, which C writes through the runtime's header. Now `lerta_status_fields` fills an `Int[]` of three, which `stat` reads by place.
- **One address writer.** `runtime/handle.c` and `std/internal/handle.lerta` both write a peer's address, which one place could.
- **C headers** are parsed with **libclang** (no custom parser; the same approach as Zig's `@cImport` and Swift's clang importer).
- **Accessors.** The C side reaches Lerta's objects through the accessors in the runtime header (`lerta_string_bytes(s, &len)` and so on), not their representation, which can then change. Ropes are flattened there.
- **Callbacks:** a trampoline from closure to C function pointer. If called from another thread, the call is forwarded to the event loop.
- Decided points:
  - C++ / Rust go through C wrappers.
  - Ownership boundary: when the C side keeps holding a value, it retains it with an explicit API (as Swift's `Unmanaged.passRetained`).
  - Passing structs by value: at first limited to passing by pointer (ABI classification is postponed).
  - Function-like macros and inline functions cannot be called. A C wrapper function is the escape hatch.

## Standard library

### std:json

- Unions with an array, a map, a tuple or an anonymous struct as a member. An array and a tuple are written as JSON arrays, a map and an anonymous struct as objects, so decoding tells apart one of each kind, as it does a class from the others.
- A class's or struct's own conversion, through a `Codable` type `J`: a method `to_json := (): J` and a [static member](objects.md#classes-and-structs) `from_json := (json: J): Self`, as a `Date` written as an ISO 8601 string.
  - The generated code converts `J` and calls them wherever the type is a part, as a field.
  - A `from_json` that throws gives a `JsonError` with the path, `$.at: <message>`.
- Unions of objects told apart by a field, as `kind`, and a dynamic JSON value type, once a program needs them. Meanwhile, a message whose fields depend on another field is decoded twice: first as a type with only that field, then as the type it names.

See [the reference](../reference/std.md#stdjson).

### std:io

See [the reference](../reference/std.md#stdio).

- The other modes of `open`: `READ`, whose `File` has a `reader`, a `Reader`; and `APPEND`, whose writes go after what the file holds.
- Later: the position of a stream, and a mode that reads and writes at given places, as a database does, through methods of the `File` of their own.
- `make_link` followed on Windows itself. Wine, which the tests run under, makes the links but does not follow them.

### std:process

See [the reference](../reference/std.md#stdprocess).

- The `Exit` of a Windows program that an exception or `TerminateProcess` ended, tested.
- **Signals taken by the program.** `signals(names: String...)`, an async iterator of the signals named, as `for await signal in signals('SIGHUP')`; one so taken no longer cancels the top-level code (see [signals](../reference/functions.md#signals)), so that a program may go on after it, as to read its settings again, or tell one signal from another.

### std:async

- `all_settled`, which waits for every promise, rejected ones too (see [the reference](../reference/std.md#stdasync)).

### std:net and std:http

- In [std:net](../reference/std.md#stdnet): TLS and Unix domain sockets.
  - Each protocol has functions named by it, as TCP's `listen_tcp` and UDP's `bind_udp`.
  - Types are named by the shape of what they carry. A Unix domain socket, a stream, is a `Socket` of `connect_unix(path)` and a `Listener` of `listen_unix(path)`, as TCP's are.
- In [std:http](../reference/std.md#stdhttp), later:
  - TLS, through that of std:net, for the server and for `fetch`;
  - a URL module for the parts of `request.url`, with which `fetch` would parse its URLs;
  - a cookie jar that a `Client` may be given, which stores the cookies of `Set-Cookie` and sends them with the requests they match;
  - HTTP/2.
- **Not planned:** a server that goes on after an accept fails for want of a socket, as on Windows.
  - There libuv makes the socket of the next connection before it comes, and stops listening for good when it cannot, which listening again does not undo. Only making the listener again could, closing its port meanwhile and losing the queued connections.
  - The failure ends the program instead, which a supervisor can restart. Windows has no small limit of sockets per process, so it comes only when the system runs out.

### Other

- Random numbers, and formatting dates and times.
- Text helpers:
  - `skip(count)` of a [Scanner](../reference/std.md#stdscanner);
  - `s.index_of(part)`: the byte offset of the first occurrence of `part`, or nil.

## Tools

### Build and run

- `.ll`/bitcode output from `lerta build`.
- With `--source-lines` on Windows, a PDB beside the program (CodeView, which LLVM gives for mingw too and lld writes), so that WinDbg and Visual Studio read the source lines, as gdb and lldb read the DWARF it holds now.
- `lerta run` running directly with JIT, and `lerta repl`.
- `lerta test`, which runs the tests of a program, each apart, and reports those that fail. Its tests are functions found by a rule yet to be decided.
- Package management.

### Playground

A page of the site where code is edited and run in the browser.

1. At first, a server compiles and runs the code and returns its output, as the Go and Rust playgrounds do. It needs no wasm, and every feature works, but the code runs in a sandbox: a container without network, with limits on time and memory.
2. Later, the server compiles to [WebAssembly](runtime.md#platforms) and the browser runs it, so that the server runs no code it is given.

- Not adopted: the compiler in the browser too. It would need LLVM there, tens of megabytes, or a backend of its own that writes wasm.

### LLVM in process

LLVM emits objects, and `lld` links them, on all platforms.

- **A C++ shim.** The compiler (in Lerta) goes as far as producing IR. Beyond that, a C++ shim takes over, exposing a few functions with `extern "C"`.
  - The exposed units are not one-to-one with the LLVM API. They are the operations the compiler needs (output, linking, JIT execution, REPL).
  - The shim receives Lerta objects (`String`, `String[]`) directly. LLVM's C++ API uses `StringRef` (pointer + length), so no conversion to NUL-terminated strings is needed.
  - lld is called as a library (through the shim, since it has no C API).
  - LLVM version differences are confined to the shim. The LLVM major version used is fixed.
- **How IR is passed:**
  1. At first, as `.ll` text (as now). The shim parses it. Easy to debug.
  2. If this is too slow, for example in the REPL, Lerta builds its own IR objects and passes them in one batch, and the shim builds the LLVM IR.
  - Not adopted: a fine-grained builder that calls an extern per instruction (too many externs, and keeping up with versions is heavy).
- The runtime is also linked into the compiler, and during JIT execution its symbols resolve as in-process symbols.

### fmt

- **The rest of the style** in [`lerta fmt`](../reference/compiler.md):
  - reporting what it cannot fix, such as a name in the wrong case;
  - the rules that change the syntax tree, such as implicit return;
  - applied only when the file type-checks, the rules that need types, such as whether a `case` handles every member of its subject.
  - The compiler reports only what concerns correctness, such as unused names.
- The formatter has no options, as it applies the style as written. Settings wait for a configuration file (see [open questions](#open-questions)).

### lsp

The rest of [`lerta lsp`](../reference/compiler.md#lsp):

- In completion:
  - the methods of extends of interfaces (as `map` of `Iterable` for an array);
  - an enum's member written alone where the enum is expected;
  - the body of a generic function that no call checks, which needs checking generic bodies at definition;
  - the code after an error in the same function's body.
- Hover and going to a definition from a named argument's label.
- A diagnostic's range over the whole token of its position, rather than the position alone.
- Checking a document that is no file yet, which the loader takes a program's modules to be.
- Finding the open documents that import a file by real paths, so that two spellings of one directory through a symbolic link are one.

### Tests of the compiler

- The command-line checks (`test/cli.lerta`) run on Windows too, through `make test-targets` (the bootstrap runs there already: see [platforms](../internals/platforms.md#platforms)), with those that run a shell made to run without one.

## Open questions

### std

- Whether an error that rejects `all` of [std:async](../reference/std.md#stdasync) cancels the other promises, and is settled once they have ended, as `race` and `timeout` are. Now it leaves them going on.
- The names that `all`, `race` and `timeout` of std:async are defined by, `gathered`, `first_settled` and `settled_within`, which a module that imports it sees on its arrays of promises.
- Whether a cancel of `run` stops the programs that the program started too, through a group of processes (a job object on Windows).
- Whether the runtime checks keep running `script` for a terminal, or `std:process` gives one (a pty).
- What type a path is. A path is taken as a `String`, but `real_path` and `make_temp_dir` give a `Binary`, so code passes one back with `.text()!`, while `list_dir` gives `String`s and throws for a name that is not UTF-8. Either they give a `String` as `list_dir` does, or a path type serves both.
- Whether `remainder` of [std:math](../reference/std.md#stdmath) is renamed, as it is C's `fmod` rather than its `remainder`.
- Whether `listen_tcp` takes a default host, as `ServerOptions.host` of std:http has, `'127.0.0.1'`.

### Compiler and FFI

- Whether `length` of an array, a map and a `Binary`, `Binary`'s indexing and the checks of an `Iter`'s start and end:
  - are generated by the compiler as loads and comparisons, as an array's indexing is, which removes `runtime/binary.c` and `runtime/iter.c` and a few functions of `runtime/string.c`;
  - or move to std through extern properties (below), which keep them C functions.
  - Either needs a seed refresh.
- Extern properties, `extern lerta_array_length as length: Int` in an extend, which read a property by calling a C function with the receiver. They would move `length` and `s.binary` to std, but they are getters written in C, which [philosophy](../philosophy.md#non-goals) leaves out; allowing them only in `std:` modules, as a builtin special case, keeps that for users.
- How a small string ([strings](strings.md#small-strings)) crosses the FFI boundary: made flat for the call, or passed as the word, which a C function then reads through the runtime.
- What a C function declared to return `Float` does when it returns NaN: throw at the boundary, as an operation does, or leave it to the caller.
- How to keep the repository small as the seed is refreshed (`seed/minilerta.ll`, see [bootstrap](../internals/architecture.md#bootstrap)): refreshing only at milestones, or keeping the seed outside the history, as with Git LFS or as a release asset.
- How to hold type information for separate compilation (interface files).

### Tools

- The package management approach (npm style vs Go's minimal version selection).
- The formatter's configuration file, such as the line length. A file holding one bracketless literal, checked as the named arguments of a configuration type, reads like YAML without being run. Decide it with the package manifest, which has the same need.
