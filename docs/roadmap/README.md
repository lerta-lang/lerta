# Roadmap

This directory holds the planned design of what is not implemented yet, by area, in no order: each part is taken up when it is chosen. What is implemented is in [the reference](../reference/README.md).

When a feature is implemented, its description moves to [the reference](../reference/README.md) and is removed from here.

| File | Area |
|---|---|
| [language.md](language.md) | Syntax, control flow, types, operators, strings |
| [objects.md](objects.md) | Classes and structs, interfaces, generics, weak references, equality |
| [runtime.md](runtime.md) | Safety, errors and exceptions, memory management, concurrency |
| [programs.md](programs.md) | Modules, FFI, the standard library, tools |

## Follow-ups

- `examples/fizzbuzz.lerta` writes `else i.to_string()` because the arms of a `case` must have one type for now. Once unions and `print` of a union of `Stringable` types work, change it to `else i`.

## Open questions

Questions of one area are in its file. These span areas:

- Default values of parameters and of constructor arguments. In the compiler, some 37 constructions pass a field's usual value, as `Local(..., mutable: false, declared: false, used: false)`. A field with an initializer is not an argument now (see [objects](../reference/objects.md)), so a default needs a way to tell such a field from an argument. Candidates:
  - Every field with an initializer, other than a method, is an argument with that default. One rule fewer, but a value computed in the body can then be overridden from outside.
  - The arguments are written after the type's name, `class Local(identifier: Identifier, mutable = false)`, with defaults as a function's parameters would have them, and the body holds the computed fields. Every class and struct is rewritten.
  - A field with an initializer is marked as an argument (`arg mutable = false`). Nothing else changes, but there is one more keyword.
- The scope of runtime type information (whether to keep field names).
