# Roadmap

## Self-hosting subset

"The minimal language needed to write the compiler itself." The compiler in `compiler/` is written in this alone, so that the [seed](internals.md#bootstrap) builds it.

### Included

- **Syntax**: `#` comments, `'...'`/`"..."` strings, indented blocks, `const`/`var`, implicit return, parenthesis-free calls (at statement start), `then`/`else` expressions, `if`/`else` statements, `case` (a simple statement after `then`/`else` on the arm's line, `else pass` for an arm that does nothing), `while`, `for x in xs`, `break`/`continue`, `return`, postfix `if`/`while`/`for`, comprehensions (`(...)` for `Iter<T>`, `[...]` for `Array<T>`), ranges `a...b`, `case` without a subject, string interpolation, destructuring, named arguments (omitting `{}` of an anonymous struct), multi-line literals (newline separation inside brackets, bracketless blocks)
- **Types**: `Int` (64-bit), `Byte` (unsigned 8-bit), `Bool`, `String`, `void`, `never`, unions and narrowing (through `and`, `or` and `not` too), `type` aliases (a union over several lines as an indented block), `T?`, `as`, `!`, `is` tests (on optional unions too), local inference
- **Data**: `class`/`struct` (no inheritance, the type body rules, `@`, named constructors, `init`, `deinit`), enums without payloads, anonymous structs, `Map` literals, `Array<T>`, `Map<K, V>`, `Iter<T>` (**only builtin types are generic**; user-defined generic types come later), `extend`, of the generic builtin types too (`extend<T> Array<T>`)
- **Functions**: generic top-level functions and methods, of classes and structs too (monomorphized, checked per instance, with the bound `Stringable`, which is structural), first-class functions, type inference for lambda parameters, closures (only captured variables go into the context)
- **Strings**: immutable, UTF-8, **flat only**. `Binary`, `Byte`, `s.binary`, `b.decode_utf8()`, `s.parse_int()`, `length`, `equals`, `hash`, `==`, `+` (concatenation), `join`
- **Memory**: RC (non-atomic), destructors. Immortal static literals
- **Modules**: `import`/`export` (named only), `import 'module'` for a module's effects, a file is a module
- **FFI**: hand-written `extern` declarations only (no libclang), `extern symbol as name: type`. Used to call runtime C functions
- **I/O**: synchronous file reading and writing, stdout/stderr, argv, exit, running other programs (the compiler runs `clang`). This is enough to write the compiler
- **Safety**: out-of-bounds access, overflow and division by zero throw (which, for now, prints to stderr and exits, like any `throw`). Panics abort
- **Exceptions**: `throw` only. The argument is a string; it is printed to stderr and the program exits (there is no `catch`)
- **Platforms**: Linux / macOS

### Runtime C functions

- In the subset, the only integer types are `Int` (64-bit) and `Byte`, so runtime C functions are written with `int64_t` / `uint8_t`.

### Standard library layout

The standard modules are Lerta files in `std/`, which call the C runtime through `extern`.

| Location | Contents |
|---|---|
| builtins | `print`, basic types (`Int`, `String`, `Array` and so on), standard interfaces |
| `'std:io'` | `read_file(path: String): Binary`, `write_file`, `Writer`, `stdout`, `stderr` |
| `'std:process'` | `argv`, `exit(code: Int): never`, `run(command: String, args: Array<String>): Int` |

- The builtins written in Lerta, `print` and most methods of the builtin types (see [builtins](reference/builtins.md)), are in `std/builtins.lerta`.
- For now, writes are synchronous. Making them asynchronous is decided in Phase 2.

### Not included (later)

- Variadic parameters `xs...`
- Multi-line string literals `"""..."""`
- Ropes, `StringSlice`, small strings as immediate values, grapheme iterators
- `catch`/`finally`, exception types, the exception implementation strategy — the compiler throws a compile error where it finds it, since the first one ends the build
- async/await, the event loop, libuv, workers
- `weak`
- User-defined `interface`, itabs, satisfying methods with function-valued fields (`Equatable`/`Hashable` are handled as builtin rules for now, and `Stringable` structurally, by `x.to_string()`)
- Generic classes and structs, generic function literals outside the top level, interfaces as bounds, and checking a generic function's body once, at its definition, against its bounds
- Operator overloading, literal construction interfaces, BigInt
- Regular expressions
- `Float` (literals are only lexed and kept as strings)
- `Int8/16/32`, `UInt16/32/64`
- Importing C headers with libclang
- Formatter, LSP, package management

## Follow-ups

- `examples/fizzbuzz.lerta` writes `else i.to_string()` because the arms of a `case` must have one type for now. Once unions and `print` of a union of `Stringable` types work, change it to `else i`.
- Modules lack, for now: `import mod from`.

## Phases and bootstrap

Run tests (source → execution result) run `bin/lerta`, the compiler written in Lerta (they ran stage0 in Phase 0). They run with the debug runtime and fail on any leak ([leak checking](internals.md#leak-checking)).

1. **Phase 0** (done): implement the subset above in TypeScript (stage0).
   - stage0 outputs `.ll` (LLVM IR text) and calls `clang` as a child process.
   - From stage0 on, features the language lacks (inheritance, getters, `any`) are sealed off while writing it.
   - Decide the minimal subset needed for self-hosting ([self-hosting subset](#self-hosting-subset)) first.
2. **Phase 1** (done): rewrite the compiler in the Lerta subset (`compiler/`) and bootstrap.
   - stage1: compile the compiler's own source with stage0.
   - stage2 / stage3: recompile the same source with stage1, then again with stage2. **stage2 == stage3** (the same LLVM IR) means the bootstrap succeeded.
   - Then stage0 was removed; for how the compiler is built now, see [bootstrap](internals.md#bootstrap).
3. **Phase 2**: complete the core of the language — exceptions and the frame chain, async and the event loop, `weak`, `interface`, user-defined generics, `Float` and all integer types.
4. **Phase 3**: the surroundings — `lerta run`/`lerta repl`, `.ll`/bitcode output from `lerta build` ([tools](design/programs.md#tools)), advanced string representations, operator overloading, regular expressions, libclang FFI, tooling. Windows programs can already be built and run (see [platforms](internals.md#platforms)); the compiler itself is not tested there yet.

## Open questions

- Whether `-1.abs()` is `(-1).abs()` (the negative literal binds first) or `-(1.abs())` (as in Rust and Python). Decide when methods on literals are implemented.
- Whether an extend should be in effect beyond the modules that import its module directly.
- How an `Iter` is written in Lerta (its `has_next` and `next`), which `take` needs to move to `std/builtins.lerta`.
- Whether to have a range that includes its end (`..`), besides `...`. A one-character difference that flips the meaning is easy to get wrong, and CoffeeScript and Rust give `..` opposite meanings.
- Whether the `else` arm of a `case` over a union narrows the subject to the members that no `when` arm names.
- Renaming in destructuring (`const { a: x } = value`).
- Sorting arrays (`compiler/sort.lerta` sorts by hand for now).
- A type alias of a union as a pattern of `case`, standing for all its members.
- Value semantics for arrays (copy-on-write), or detection of modification during iteration.
- Semantics of the regular expression engine (JS/PCRE-style backtracking vs RE2-style linear time).
- How to handle conversion from an interface value to another interface (the concrete type is unknown until run time, so a static itab is not enough; forbid it or generate at run time).
- How to pass values to workers (candidates: deep copy only + sharing immutable `Binary` / run-time moves like JS transfer).
- The type of asynchronous results (its name, and the type of async functions that return no value).
- The name of the type common to all exceptions (the type caught by an untyped `catch`).
- Default parameter values.
- Notation for writing an array inside an array without brackets (CoffeeScript can).
- The type of a character (code point) (the element of `s.chars()`; `Int` or a `Char` type).
- `Binary` literals (`'...'.binary` can substitute).
- The ABI of `String` at the FFI boundary (pass as a 16-byte value, or box it in the heap representation; decide when small strings become immediate values).
- The exception implementation strategy (choose from [the candidates](internals.md#exception-implementation-planned-undecided-candidates)).
- The scope of runtime type information (whether to keep field names).
- How to trigger serialization code generation (an annotation on the type, or automatic generation from calls such as `json.decode<T>`).
- How to hold type information for separate compilation (interface files).
- The package management approach (npm style vs Go's minimal version selection).
