# Philosophy

## Design principles

In priority order:

1. **Shape shows structure**
   - Code is seen before it is read. Indentation shows a program's structure at a glance.
   - Denser code is not always better code.
   - The formatter lays out every program, so that all Lerta code looks alike.
2. **Least surprise**
   - Intuitive to read and to write.
   - Prefer what widely used languages have already taught the reader.
3. **Fewest rules**
   - Keep the language specification and grammar to the necessary minimum.
   - One way to write each thing.
4. **Cost is visible**
   - What a line does shows in it. The only work it does unseen is [reference counting](internals/memory.md), [exception checks](internals/execution.md#exceptions) and the checks that safety needs.
5. **Punctuation in moderation**
   - Too much punctuation is noise; well-placed punctuation reads better than none.

## Goals

- **Safety:** zero undefined behavior outside [C functions](reference/functions.md#c-functions), whose existence and types the compiler does not check. Every operation returns a defined value or fails in a defined way.
- **Performance:** to be as fast as the other compiled languages that check what they run, or faster, and as Node.js, whose compiler works at run time.

## Non-goals

- Macros and compile-time evaluation written by the user. The compiler has built-in special cases instead, such as code generation for serialization to JSON.
- Runtime reflection, beyond type IDs and downcasts.
- A thread API.
- ABI stability for dynamic libraries.
- `any`, inheritance, delegation (automatic forwarding), getters, `import *`, `export default`, `undefined`, `null`.

## Lineage

Lerta takes its syntax from CoffeeScript (indentation, `->`, `@`); its type inference and narrowing from TypeScript; its optional types, memory model and exceptions from Swift (`T?`, reference counting with weak references, exceptions compiled to error return values); and its event loop from Node.js and libuv.
