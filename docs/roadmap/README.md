# Roadmap

This directory holds the planned design of what is not implemented yet, by area. Within an area, the parts are in no order; across areas, [Milestones](#milestones) sets what comes first. What is implemented is in [the reference](../reference/README.md).

When a feature is implemented, its description moves to [the reference](../reference/README.md), or for the internal design to [the internals](../internals.md), and is removed from here.

| File | Area |
|---|---|
| [language.md](language.md) | Syntax, control flow, types, operators |
| [strings.md](strings.md) | Strings, their operations and regular expressions |
| [objects.md](objects.md) | Classes and structs, interfaces, generics, equality |
| [runtime.md](runtime.md) | Safety, errors and exceptions, memory management, concurrency |
| [programs.md](programs.md) | Modules, FFI, the standard library, tools |

## Milestones

Each milestone is a kind of program that can be written once it is reached, so that real programs, not only the compiler, find what the language lacks.

1. **The test harness in Lerta** ([tools](programs.md#tools)), with what it needs of the [standard library](programs.md#standard-library).

Whether the runtime collects cycles ([runtime](runtime.md#open-questions)) is decided before milestone 1 is reached, from programs driven by events, rather than after async/await is complete.

## Dependencies

Where one part needs another first, across areas:

- Checking a generic body at definition ([objects](objects.md#generics)) needs a bound to allow every operator the body uses, as `x * 2` needs `Mul` (see [operators](../reference/builtins.md#operators)).

An order within one area is stated in its file.

## Follow-ups

- The documents: a tour of the language of working examples only, a summary of the grammar, the builtin methods in [builtins](../reference/builtins.md) with their signatures and a line each rather than a list of names, and the longest items of the reference (as of generic classes in [objects](../reference/objects.md)) split under headings.

## Open questions

Questions of one area are in its file. These span areas:

- The scope of runtime type information (whether to keep field names).
