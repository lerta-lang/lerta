# Programs

The planned design of modules, FFI, the standard library and tools.

## C ABI / FFI

- An `Int?` parameter of an extern, a `LertaOptionalInt` of 16 bytes, passed as C takes it on Windows, by a pointer to a copy: now it is passed by value, which a C function there misreads, so std passes an `Int` with -1 for nil instead, as `run` does its `output_limit`. The x86-64 ABI of the other systems takes it by value, in two registers.
- An `extern` declaration may also refer to a C variable.
- Generic externs, `extern lerta_map_remove: <K, V>(Map<K, V>, K) -> void`, for C functions that take a value of any type as a pointer, as an array, a map or a String is. With them, the method `remove`, built into the compiler now (see [internals](../internals.md#builtins)), moves to `std/builtins/`, and so would the properties `length` and `s.binary` with extern properties (see [open questions](#open-questions)); `push`, `pop` and indexing stay built in, since their code depends on the items' kind. Using them in std needs a seed refresh.
- C headers are parsed with **libclang** (no custom parser; the same approach as Zig's `@cImport` and Swift's clang importer).
- The C side reaches Lerta's objects through the accessors in the runtime header (`lerta_string_bytes(s, &len)` and so on), not their representation, which can then change. Ropes are flattened there.
- Callbacks: a trampoline from closure to C function pointer. If called from another thread, the call is forwarded to the event loop.
- Decided points:
  - C++ / Rust go through C wrappers.
  - Ownership boundary: when the C side keeps holding a value, it retains it with an explicit API (equivalent to Swift's `Unmanaged.passRetained`).
  - Passing structs by value: initially limited to passing by pointer (ABI classification is postponed).
  - Function-like macros and inline functions cannot be called. Writing a C wrapper function is the escape hatch.

## Standard library

- In [std:json](../reference/std.md#stdjson), unions with an array, a map, a tuple or an anonymous struct as a member: an array and a tuple are written as JSON arrays, and a map and an anonymous struct as objects, so decoding tells apart one of each kind, as it does a class from the others.
- In [std:json](../reference/std.md#stdjson), unions of objects told apart by a field, as `kind`, and a dynamic JSON value type wait until a program needs them: a message whose fields depend on another field is decoded twice, first as a type with only that field, then as the type it names.
- Random numbers, and formatting dates and times.
- In [std:net](../reference/std.md#stdnet), UDP, TLS and Unix domain sockets. Each protocol has functions named by it, as TCP's `listen_tcp` and `connect_tcp`, and the types are named by the shape of what they carry: a Unix domain socket, a stream, is a `Socket` of `connect_unix(path)` and a `Listener` of `listen_unix(path)`, as TCP's are, and UDP, of datagrams, is a `UdpSocket` of `bind_udp(host, port)`.
- In [std:http](../reference/std.md#stdhttp), what a server needs in production, in this order:
  - `server.close()` that ends kept connections after the request they serve, and a promise that it settles once they have ended (graceful shutdown); an accept that fails while the server is open, as for too many open files, retried after a pause rather than ending the program.
  - A `Date` field, and `Expect: 100-continue`.
  - Later: TLS, through that of std:net, for the server and for `fetch`; a URL module for the parts of `request.url`, which `fetch` would parse its URLs with; a cookie jar that a `Client` may be given, which stores the cookies of `Set-Cookie` and sends them with the requests they match; and HTTP/2.
- `make_link` of [std:io](../reference/std.md#stdio) followed on Windows itself: Wine, which the tests run under, makes the links but does not follow them.
- The `Exit` of [std:process](../reference/std.md#stdprocess) of a Windows program that an exception or `TerminateProcess` ended, tested.

## Tools

- `.ll`/bitcode output from `lerta build`.
- With `--source-lines` on Windows, a PDB beside the program (CodeView, which LLVM gives for mingw too, and lld writes), so that WinDbg and Visual Studio read the source lines, as gdb and lldb read the DWARF that it holds now.
- LLVM emits objects, and `lld` links them, on all platforms:
  - The compiler itself (in Lerta) goes as far as producing IR. Beyond that, a **C++ shim** takes over (it exposes a few functions with `extern "C"`).
    - The exposed units are not one-to-one with the LLVM API. They are the operations the compiler needs (output, linking, JIT execution, REPL).
    - The shim receives Lerta objects (`String`, `String[]`) directly. LLVM's C++ API uses `StringRef` (pointer + length), so no conversion to NUL-terminated strings is needed.
    - lld is called as a library (through the shim, since it has no C API).
    - LLVM version differences are confined to the shim. The LLVM major version used is fixed.
  - How IR is passed:
    1. At first, as `.ll` text (as now). The shim parses it. Easy to debug.
    2. If this is too slow, for example in the REPL, move to a scheme where Lerta builds its own IR objects and passes them in one batch, and the shim builds the LLVM IR.
    - A fine-grained builder that calls an extern per instruction is not adopted (too many externs, and keeping up with versions is heavy).
  - The runtime is also linked into the compiler, and during JIT execution its symbols resolve as in-process symbols.
- `lerta run` running directly with JIT, and `lerta repl`.
- The rest of the style in [`lerta fmt`](../reference/compiler.md): reporting what it cannot fix, such as a name in the wrong case or a line it cannot bring within 100 columns; the rules that change the syntax tree, such as implicit return; and, applied only when the file type-checks, the rules that need types, such as whether a `case` handles every member of its subject. The compiler reports only what concerns correctness, such as unused names.
- `lerta fmt` reports each difference under the rule that it breaks, and each run of differing lines apart, as [the reference](../reference/compiler.md#fmt) states: now some are reported under another rule, as the shorthand of `{ x: x }` under **Layout**, a cast left out before a space, or a rewrite that starts the body of a function on the line of `->`, under the rule of what holds it, and the named arguments that a name written alone goes before under **Long lists**, and separate runs that differ may be reported as one. The formatter has no options, as it applies the style as written; settings wait for a configuration file (see [open questions](#open-questions)).
- The rest of [`lerta lsp`](../reference/compiler.md#lsp):
  - In completion: the methods of extends of interfaces (as `map` of `Iterable` for an array), an enum's member written alone where the enum is expected, the body of a generic function that no call checks, which needs checking generic bodies at definition, and the code after an error in the same function's body.
  - Hover and going to a definition from a type name, as one in an annotation or the enum of `Color.RED`, and from a named argument's label.
  - A diagnostic's range over the whole token of its position, rather than the position alone.
  - Checking a document that is no file yet, which the loader takes a program's modules to be; and finding the open documents that import a file by real paths, so that two spellings of one directory through a symbolic link are one.
- Package management.
- The command-line checks (`test/cli.lerta`) run on Windows too, through `make test-cross` (the bootstrap runs there already: see [platforms](../internals.md#platforms)), with those that run a shell made to run without one.

## Open questions

- Whether an error that rejects `all` of [std:async](../reference/std.md#stdasync) cancels the other promises, and is settled once they have ended, as `race` and `timeout` are; now it leaves them going on.
- Whether a cancel of `run` stops the programs that the program started too, through a group of processes (a job object on Windows).
- Whether the runtime checks keep running `script` for a terminal, or `std:process` gives one (a pty).
- Whether `length` of an array, a map and a `Binary`, `Binary`'s indexing and the checks of an `Iter`'s start and end are generated by the compiler as loads and comparisons, as an array's indexing is, which removes `runtime/binary.c` and `runtime/iter.c` and a few functions of `runtime/string.c`, or move to std through extern properties (below), which keep them C functions. Either needs a seed refresh.
- Extern properties, `extern lerta_array_length as length: Int` in an extend, which read a property by calling a C function with the receiver. They would move `length` and `s.binary` to std, but they are getters written in C, which [philosophy](../philosophy.md#non-goals) leaves out; allowing them only in `std:` modules, as a builtin special case, keeps that for users.
- The ABI of `String` at the FFI boundary (pass as a 16-byte value, or box it in the heap representation; decide when small strings become immediate values).
- What a C function declared to return `Float` does when it returns NaN: throw at the boundary, as an operation does, or leave it to the caller.
- How to keep the repository small as the seed is refreshed (`seed/minilerta.ll`, see [bootstrap](../internals.md#bootstrap)): refreshing only at milestones, or keeping the seed outside the history, as with Git LFS or as a release asset.
- How to hold type information for separate compilation (interface files).
- The package management approach (npm style vs Go's minimal version selection).
- The formatter's configuration file, such as the line length. A file holding one bracketless literal, checked as the named arguments of a configuration type, reads like YAML without being run; decide it with the package manifest, which has the same need.
