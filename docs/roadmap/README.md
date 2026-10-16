# Roadmap

This directory holds the planned design of what is not implemented yet, by area, in no order: each part is taken up when it is chosen. What is implemented is in [the reference](../reference/README.md).

When a feature is implemented, its description moves to [the reference](../reference/README.md), or for the internal design to [the internals](../internals.md), and is removed from here.

| File | Area |
|---|---|
| [language.md](language.md) | Syntax, control flow, types, operators |
| [strings.md](strings.md) | Strings, their operations and regular expressions |
| [objects.md](objects.md) | Classes and structs, interfaces, generics, equality |
| [runtime.md](runtime.md) | Safety, errors and exceptions, memory management, concurrency |
| [programs.md](programs.md) | Modules, FFI, the standard library, tools |

## Dependencies

Where one part needs another first, across areas:

- Checking a generic body at definition ([objects](objects.md#generics)) needs the [operator interfaces](language.md#operator-overloading), since a bound must then allow every operator the body uses, as `x * 2`.
- Decoding JSON into a union of `Int` and `String` ([programs](programs.md#standard-library)), which the LSP needs for a request's `id`, needs [union members other than classes and structs](language.md#types).

An order within one area is stated in its file.

## Follow-ups

- `examples/fizzbuzz.lerta` writes `else i.to_string()` because the arms of a `case` must have one type for now. Once unions and `print` of a union of `Stringable` types work, change it to `else i`.
- The error for a type that cannot be extended lists the kinds that can (`compiler/checker/extend_declarations.lerta`) apart from `EXTENDABLE_KINDS`, and leaves out `Float`: derive the list from it.

## Open questions

Questions of one area are in its file. These span areas:

- The scope of runtime type information (whether to keep field names).
