# Philosophy

Lerta is a language for code you can see at a glance: indented like CoffeeScript, with types inferred as in TypeScript, and compiled to native code through LLVM. Programs are single-threaded and event-driven, with no undefined behavior in Lerta code and no tracing GC, and they run about as fast as Go.

## Design principles

In priority order:

1. **Shape shows structure**
   - Code is seen before it is read. Indentation shows a program's structure at a glance.
   - Denser code is not always better code.
   - The formatter lays out every program, so that all Lerta code looks alike.
2. **Least surprise**
   - Intuitive to read and to write.
   - Prefer what widely used languages already taught the reader.
3. **Fewest rules**
   - Keep the language specification and grammar to the necessary minimum.
   - One way to write each thing.
4. **Cost is visible**
   - What a line does shows in it. The only work it does unseen is [reference counting](internals/memory.md) and [exception checks](internals/execution.md#exceptions).
5. **Punctuation in moderation**
   - Too much punctuation is noise; well-placed punctuation reads better than none.

## Safety

Safety means **zero undefined behavior** outside [C functions](reference/functions.md#c-functions), whose existence and types the compiler does not check: every operation returns a defined value or fails in a defined way.

- **Nil safety** comes from [optional types](reference/types.md#optional-values).
- **Weak safety** comes from [weak references](reference/objects.md#weak-references): once their object is gone, they give nil or throw, never a dangling pointer.
- **No data races,** because programs are single-threaded.

Planned rules are in [the roadmap](roadmap/runtime.md#safety).

## Performance

Lerta is mostly faster than Swift and Node.js, on par with Go, and close to C, without a tracing GC: memory is [reference counted](internals/memory.md), and generics are monomorphized. Reference cycles are not collected; weak references break them ([roadmap](roadmap/runtime.md#memory-management)). The results are in [bench/](../bench/README.md).

## Non-goals

- Macros and compile-time evaluation written by the user. The compiler has built-in special cases instead, such as code generation for serialization to JSON.
- Runtime reflection, beyond type IDs and downcasts.
- A thread API.
- ABI stability for dynamic libraries.
- `any`, inheritance, delegation (automatic forwarding), getters, `import *`, `export default`, `undefined`, `null`.

## Lineage

Lerta takes its syntax from CoffeeScript (indentation, `->`, `@`); its type inference and narrowing from TypeScript; its optional types, memory model and exceptions from Swift (`T?`, reference counting with weak references, exceptions compiled to error return values); and its event loop from Node.js and libuv.
