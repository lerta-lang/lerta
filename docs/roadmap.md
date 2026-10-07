# Roadmap

## stage0 subset (for self-hosting)

"The minimal language needed to write the compiler itself." stage1 is built with this alone.

### Included

- **Syntax**: `#` comments, `'...'`/`"..."` strings, indented blocks, `const`/`var`, implicit return, parenthesis-free calls (at statement start), `then`/`else` expressions, `if`/`else` statements, `case`, `while`, `for x in xs`, `break`/`continue`, `return`, postfix `if`/`while`/`for`, comprehensions (`(...)` for `Iter<T>`, `[...]` for `Array<T>`), ranges `a...b`, `case` without a subject, string interpolation, destructuring, named arguments (omitting `{}` of an anonymous struct), multi-line literals (newline separation inside brackets, bracketless blocks)
- **Types**: `Int` (Int64), `UInt8` (with `Byte` as its alias), `Bool`, `String`, `void`, `never`, unions and narrowing, `type` aliases, `T?`, `as`, `!`, `is` tests, local inference
- **Data**: `class`/`struct` (no inheritance, the type body rules, `@`, named constructors, `init`, `deinit`), anonymous structs, `Map` literals, `Array<T>`, `Map<K, V>`, `Iter<T>` (**only built-in types are generic**; user-defined generics come later)
- **Functions**: first-class functions, type inference for lambda parameters, closures (only captured variables go into the context)
- **Strings**: immutable, UTF-8, **flat only**. `Binary`, `Byte`, `s.binary`, `b.decode_utf8()`, `s.parse_int()`, `length`, `equals`, `hash`, `==`, `+` (concatenation), `join`
- **Memory**: RC (non-atomic), destructors. Immortal static literals
- **Modules**: `import`/`export` (named only), a file is a module
- **FFI**: hand-written `extern` declarations only (no libclang). Used to call runtime C functions
- **I/O**: synchronous file reading and writing, stdout/stderr, argv, exit. This is enough to write the compiler
- **Safety**: out-of-bounds access, overflow and division by zero throw (which in stage0 prints to stderr and exits, like any `throw`). Panics abort
- **Exceptions**: `throw` only. The argument is a string; it is printed to stderr and the program exits (there is no `catch`)
- **Platforms**: Linux / macOS

### Runtime C functions in stage0

- In stage0 the only integer types are `Int` (64-bit) and `UInt8`, so runtime C functions are written with `int64_t` / `uint8_t`.

### Standard library layout in stage0

| Location | Contents |
|---|---|
| builtins | `print`, basic types (`Int`, `String`, `Array` and so on), standard interfaces |
| `'std:io'` | `read_file(path: String): Binary`, `write_file`, `stdout`, `stderr` |
| `'std:process'` | `argv`, `exit(code: Int): never` |

- In stage0, writes are synchronous. Making them asynchronous is decided in Phase 2.
- Until `extern` is implemented, `print` is implemented in the C runtime (`lerta_print_string` and `lerta_print_int`) and called directly by the compiler. It moves to Lerta once `extern` exists.

### Not included (later)

- Variadic parameters `xs...`
- Multi-line string literals `"""..."""`
- Ropes, `StringSlice`, small strings as immediate values, grapheme iterators
- `catch`/`finally`, exception types, the exception implementation strategy — compile errors are collected as values
- async/await, the event loop, libuv, workers
- `weak`
- User-defined `interface`, itabs, satisfying methods with function-valued fields (`Equatable`/`Hashable`/`Stringable` are handled as built-in rules in stage0)
- User-defined generics
- Operator overloading, literal construction interfaces, BigInt
- Regular expressions
- `Float` (literals are only lexed and kept as strings)
- `Int8/16/32`, `UInt16/32/64`
- Importing C headers with libclang
- Windows
- Formatter, LSP, package management

## Follow-ups

- `examples/fizzbuzz.lerta` writes `else i.to_string()` because the arms of a `case` must have one type for now. Once unions and `print` of a union of `Stringable` types work, change it to `else i`.
- Modules lack, for now: exported values other than functions (functions cannot see top-level values yet), circular imports, classes and structs of the same name in different modules (the generated code names them by their name alone), `import { a as b }` and `import mod from`.

## Phases and bootstrap

Run tests (source → execution result) are shared by all stages. They run with the debug runtime and fail on any leak ([leak checking](internals.md#leak-checking)), from stage0 on.

1. **Phase 0**: implement the subset above in TypeScript (stage0).
   - stage0 outputs `.ll` (LLVM IR text) and calls `clang` as a child process.
   - From stage0 on, features the language lacks (inheritance, getters, `any`) are sealed off while writing it.
   - Decide the minimal subset needed for self-hosting ([stage0 subset](#stage0-subset-for-self-hosting)) first.
2. **Phase 1**: rewrite the compiler in the Lerta subset and bootstrap.
   - stage1: compile the compiler's own source with stage0.
   - stage2 / stage3: recompile the same source with stage1, then again with stage2. **stage2 == stage3** means the bootstrap succeeded.
3. **Phase 2**: complete the core of the language — exceptions and the frame chain, async and the event loop, `weak`, `interface`, user-defined generics, `Float` and all integer types.
4. **Phase 3**: the surroundings — `lerta run`/`lerta repl`, `.ll`/bitcode output from `lerta build` ([tools](design/programs.md#tools)), advanced string representations, operator overloading, regular expressions, libclang FFI, Windows, tooling.

## Open questions

- Whether `-1.abs()` is `(-1).abs()` (the negative literal binds first) or `-(1.abs())` (as in Rust and Python). Decide when methods on literals are implemented.
- Whether to have a range that includes its end (`..`), besides `...`. A one-character difference that flips the meaning is easy to get wrong, and CoffeeScript and Rust give `..` opposite meanings.
- Whether to add enums without payloads (for now, `case` on values substitutes).
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
- The exception implementation strategy (choose from [the candidates](internals.md#exception-implementation-undecided-candidates)).
- The scope of runtime type information (whether to keep field names).
- How to trigger serialization code generation (an annotation on the type, or automatic generation from calls such as `json.decode<T>`).
- How to hold type information for separate compilation (interface files).
- The package management approach (npm style vs Go's minimal version selection).
