# Roadmap

This directory holds the planned design of what is not implemented yet, by area. The parts are in no order, but for [the dependencies](#dependencies) between areas. What is implemented is in [the reference](../reference/README.md).

When a feature is implemented, its description moves to [the reference](../reference/README.md), or for the internal design to [the internals](../internals.md), and is removed from here.

| File | Area |
|---|---|
| [language.md](language.md) | Syntax, control flow, types, operators |
| [strings.md](strings.md) | Strings, their operations and regular expressions |
| [objects.md](objects.md) | Classes and structs, interfaces, generics, equality |
| [runtime.md](runtime.md) | Safety, errors and exceptions, memory management, concurrency, platforms |
| [programs.md](programs.md) | Modules, FFI, the standard library, tools |

## Dependencies

Where one part needs another first, across areas:

- Checking a generic body at definition ([objects](objects.md#generics)) needs a bound to allow every operator the body uses, as `x * 2` needs `Mul` (see [operators](../reference/builtins.md#operators)).

An order within one area is stated in its file.

## Follow-ups

- The documents: a tour of the language of working examples only, a summary of the grammar, the builtin methods in [builtins](../reference/builtins.md) with their signatures and a line each rather than a list of names, and the longest items of the reference (as of generic classes in [objects](../reference/objects.md)) split under headings. The item of `Reader`, `Writer` and `Pipe` in [std](../reference/std.md#stdio), of one paragraph, is one of them.

## Open questions

Questions of one area are in its file. These span areas:

- The scope of runtime type information (whether to keep field names).
