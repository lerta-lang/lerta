# Roadmap

This directory holds the planned design of what is not implemented yet, by area. The parts are in no order; an order within one area is stated in its file. What is implemented is in [the reference](../reference/README.md).

When a feature is implemented, its description moves to [the reference](../reference/README.md), or for the internal design to [the internals](../internals/README.md), and is removed from here.

| Page | Area |
|---|---|
| [Language](language.md) | Syntax, control flow, types, operators |
| [Strings](strings.md) | Strings, their operations and regular expressions |
| [Objects](objects.md) | Classes and structs, interfaces, generics, equality |
| [Runtime](runtime.md) | Safety, errors and exceptions, memory management, concurrency, platforms |
| [Programs](programs.md) | Modules, FFI, the standard library, tools |

## Follow-ups

- The documents: a summary of the grammar, and the longest items of the reference (as of generic classes in [objects](../reference/objects.md)) split under headings.

## Open questions

Questions of one area are in its file. These span areas:

- The scope of runtime type information (whether to keep field names).
- The style of the tour (see [follow-ups](#follow-ups)): short sentences and examples that its tests run, the reasons staying in the reference.
