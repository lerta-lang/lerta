# Roadmap

This directory holds the planned design of what is not implemented yet, by area, in no order: each part is taken up when it is chosen. What is implemented is in [the reference](../reference/README.md).

When a feature is implemented, its description moves to [the reference](../reference/README.md) and is removed from here.

| File | Area |
|---|---|
| [language.md](language.md) | Syntax, control flow, types, operators, strings |
| [objects.md](objects.md) | Classes and structs, interfaces, generics, weak references, equality |
| [runtime.md](runtime.md) | Safety, errors and exceptions, memory management, concurrency |
| [programs.md](programs.md) | Modules, FFI, the standard library, tools |

## Dependencies

Where one part needs another first, across areas:

- Checking a generic body at definition ([objects](objects.md#generics)) needs the [operator interfaces](language.md#operator-overloading), since a bound must then allow every operator the body uses, as `x * 2`.

An order within one area is stated in its file.

## Follow-ups

- `examples/fizzbuzz.lerta` writes `else i.to_string()` because the arms of a `case` must have one type for now. Once unions and `print` of a union of `Stringable` types work, change it to `else i`.
- Split `runtime/lerta.h`: what only the runtime's own C code uses (its "Runtime-internal helpers", the platform functions, and the others that nothing outside `runtime/` calls) moves to a new `runtime/internal.h`, which includes `lerta.h` and which the `.c` files include. A new file of the runtime needs a seed refresh (see [internals](../internals.md#bootstrap)), so this waits for the next one.

## Open questions

Questions of one area are in its file. These span areas:

- The scope of runtime type information (whether to keep field names).
