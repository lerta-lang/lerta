# Philosophy

Lerta is a safe, single-threaded, event-driven language. It targets both native executables and [scripts](roadmap/programs.md#tools).

Lerta's stance is that **cost is visible**: what a line does shows in it, beyond [reference counting](internals.md#memory-management) and [exception checks](internals.md#exceptions).

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
   - So `void` is not a type: generics cannot treat returning a value and returning nothing alike, and where both are needed, the standard library needs a function of each kind, as a `for_each` would be beside `map`.
4. **Punctuation in moderation**
   - Too much punctuation is noise and makes code hard to read.
   - But well-placed punctuation reads better than none at all.
   - Prefer punctuation in the meaning that widely used languages give it.

## Safety

Safety means **zero undefined behavior** outside [C functions](reference/functions.md#c-functions), whose existence and types the compiler does not check: every operation returns a defined value or fails in a defined way.

- **Nil safety** comes from [optional types](reference/types.md#optional-values).
- **Weak safety** comes from [`weak!` fields](reference/objects.md#weak-references), which throw once their object is gone.
- **No data races,** because programs are single-threaded.

Planned rules are in [the roadmap](roadmap/runtime.md#safety).

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
| Syntax | CoffeeScript (indentation, `->`, `@`), Nim (command syntax, without its nesting) |
| RC + weak | Swift ARC, Rust `Rc`/`Weak` |
| Single thread + async | Node.js / V8, libuv |
| interface / itab | Go, Objective-C non-fragile ivars |
| Strings | V8 (ConsString / SlicedString), Swift (small strings, `Substring`), PEP 393 |
| Frame chain | Stackless Python, Scheme implementations, LLVM shadow stack, V8 contexts |
| FFI | Zig `@cImport`, Swift clang importer, Nim c2nim |
| Generics | Rust (monomorphization + `linkonce_odr`, trait bounds) |
| Exceptions | Swift (error return values) |
| Bootstrap | GCC `make bootstrap`, Rust, Crystal |

## Why not Nim or Crystal

Both are close, and much of Lerta is in them already. Lerta differs in what it leaves out.

- **Nim** has the syntax and the memory management: its ARC is Lerta's reference counting. Lerta differs:
  - Nim's default, ORC, also collects cycles, which Lerta does not for now ([roadmap](roadmap/runtime.md#memory-management)).
  - Nim has several ways to write one thing: identifiers that differ only in `_` or in the case of letters after the first are one name; a call can be written `f(a, b)`, `a.f(b)` or `f a, b`; routines come in seven kinds; and templates and macros are central.
  - Nil safety is a rule in Lerta; in Nim, `not nil` is experimental.
  - Nim's syntax looks like Python's, but its conventions come from Pascal and its own: `$x` makes a string, `&` joins strings, and a routine returns the implicit `result`.
- **Crystal** has the types: unions, `T?` as `T | Nil`, and narrowing. Lerta takes instead:
  - explicit parameter types over Crystal's parameters typed by each call, so that modules can be compiled apart ([roadmap](roadmap/programs.md#open-questions));
  - reference counting over a tracing GC;
  - no macros, which Crystal's standard library is built on.
