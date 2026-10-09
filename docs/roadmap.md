# Roadmap

What the language has is in [the reference](reference/README.md), and what it is planned to have in [the design](design/README.md). This page lists what is left, by area and in no order: each is taken up when it is chosen.

## Not implemented yet

- **Syntax**: variadic parameters `xs...`, multi-line string literals `"""..."""`
- **Types**: `Float` (literals are only lexed and kept as strings), `Int8/16/32`, `UInt16/32/64`, BigInt
- **Objects and generics**: user-defined `interface`, itabs, methods satisfied by function-valued fields (`Stringable` is structural for now, by `x.to_string()`); generic classes and structs, generic function literals outside the top level, interfaces as bounds, and checking a generic function's body once, at its definition, against its bounds; `weak` fields that read as nil and `weak var` locals; user-defined `equals` and `hash`; operator overloading and literal construction interfaces
- **Errors**: `catch`/`finally`, exception types and their implementation strategy, the frame chain
- **Concurrency**: async/await, the event loop on libuv, asynchronous writes, workers
- **Strings**: ropes, `StringSlice`, small strings as immediate values, grapheme iterators, regular expressions
- **Programs and tools**: importing C headers with libclang, `.ll`/bitcode output from `lerta build`, `lerta run` with a JIT and `lerta repl` ([tools](design/programs.md#tools)), a formatter, an LSP, package management, testing the compiler itself on Windows (its programs are built and run there already: see [platforms](internals.md#platforms))

## Follow-ups

- `examples/fizzbuzz.lerta` writes `else i.to_string()` because the arms of a `case` must have one type for now. Once unions and `print` of a union of `Stringable` types work, change it to `else i`.
- Modules lack, for now: `import mod from`.

## Open questions

- Whether `-1.abs()` is `(-1).abs()` (the negative literal binds first) or `-(1.abs())` (as in Rust and Python). Decide when methods on literals are implemented.
- Whether an extend should be in effect beyond the modules that import its module directly.
- How an `Iter` is written in Lerta (its `has_next` and `next`), which `take` needs to move to `std/builtins.lerta`.
- Whether to have a range that includes its end (`..`), besides `...`. A one-character difference that flips the meaning is easy to get wrong, and CoffeeScript and Rust give `..` opposite meanings.
- Whether the `else` arm of a `case` over a union narrows the subject to the members that no `when` arm names.
- Renaming in destructuring (`const { a: x } = value`).
- Sorting arrays (`compiler/sort.lerta` sorts by hand for now).
- Value semantics for arrays (copy-on-write), or detection of modification during iteration.
- Semantics of the regular expression engine (JS/PCRE-style backtracking vs RE2-style linear time).
- How to handle conversion from an interface value to another interface (the concrete type is unknown until run time, so a static itab is not enough; forbid it or generate at run time).
- How to pass values to workers (candidates: deep copy only + sharing immutable `Binary` / run-time moves like JS transfer).
- The type of asynchronous results (its name, and the type of async functions that return no value).
- The name of the type common to all exceptions (the type caught by an untyped `catch`).
- Default values of parameters and of constructor arguments. In the compiler, some 37 constructions pass a field's usual value, as `Local(..., mutable: false, declared: false, used: false)`. A field with an initializer is not an argument now (see [objects](reference/objects.md)), so a default needs a way to tell such a field from an argument. Candidates:
  - Every field with an initializer, other than a method, is an argument with that default. One rule fewer, but a value computed in the body can then be overridden from outside.
  - The arguments are written after the type's name, `class Local(identifier: Identifier, mutable = false)`, with defaults as a function's parameters would have them, and the body holds the computed fields. Every class and struct is rewritten.
  - A field with an initializer is marked as an argument (`arg mutable = false`). Nothing else changes, but there is one more keyword.
- Notation for writing an array inside an array without brackets (CoffeeScript can).
- The type of a character (code point) (the element of `s.chars()`; `Int` or a `Char` type).
- `Binary` literals (`'...'.binary` can substitute).
- The ABI of `String` at the FFI boundary (pass as a 16-byte value, or box it in the heap representation; decide when small strings become immediate values).
- The exception implementation strategy (choose from [the candidates](internals.md#exception-implementation-planned-undecided-candidates)).
- The scope of runtime type information (whether to keep field names).
- How to trigger serialization code generation (an annotation on the type, or automatic generation from calls such as `json.decode<T>`).
- How to hold type information for separate compilation (interface files).
- The package management approach (npm style vs Go's minimal version selection).
