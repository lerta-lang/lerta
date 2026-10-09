# Philosophy

Lerta is a safe, single-threaded, event-driven language. It targets both native executables and scripts.

Lerta's stance is that **cost is visible**. This is close to Zig's "no hidden control flow" and Rust's "zero-cost abstractions".

## Design principles

In priority order:

1. **Write less, do more**
   - Express the user's intent exactly, with minimal code.
   - Do not sacrifice readability for brevity.
   - For the user, whitespace and indentation are not tokens to "read" but visual information to "see". They show the structure at a glance and help reading.
2. **Least surprise**
   - Intuitive to read and to write.
3. **Fewest rules**
   - Keep the language specification and grammar rules to the necessary minimum.
4. **Punctuation in moderation**
   - Too much punctuation is noise and makes code hard to read.
   - But well-placed punctuation reads better than none at all.

## Safety

Safety means **zero undefined behavior**: every operation returns a defined value or fails in a defined way. Nil safety comes from [optional types](reference/types.md#optional-values) and weak safety from [`weak!` fields](reference/objects.md#classes-and-structs), which throw once their object is gone; there are no data races because programs are single-threaded. Planned rules are in [the roadmap](roadmap/runtime.md#safety).

## Non-goals

- Macros and compile-time evaluation **written by the user**
  - The compiler does have built-in special cases: regular expression literals, and code generation for serialization (JSON and so on).
- Runtime reflection (only type IDs and downcasts; JSON and similar formats use the code generation above)
- ABI stability for dynamic libraries
- A thread API
- `any`, inheritance, delegation (automatic forwarding), getters, `import *`, `export default`, tab indentation
- `undefined`, `null`

## Prior art

| Area | Reference |
|---|---|
| Overall architecture | Crystal (Ruby syntax + inference + LLVM), Swift, Go |
| RC + weak | Swift ARC, Rust `Rc`/`Weak` |
| Single thread + async | Node.js / V8, libuv |
| interface / itab | Go, Objective-C non-fragile ivars |
| Strings | V8 (ConsString / SlicedString), Swift (small strings, `Substring`), PEP 393 |
| Frame chain | Stackless Python, Scheme implementations, LLVM shadow stack, V8 contexts |
| FFI | Zig `@cImport`, Swift clang importer, Nim c2nim |
| Generics | Rust (monomorphization + `linkonce_odr`, trait bounds) |
| Exception implementation (candidates) | Stackless Python, LLVM shadow stack, Itanium C++ ABI, Swift (error return values) |
| Bootstrap | GCC `make bootstrap`, Rust, Crystal |
