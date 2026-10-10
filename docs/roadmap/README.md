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
- `runtime/iter.c` keeps `lerta_throw_iter_ended`, which the seed's generated code calls, and code of the programs that the seed builds stops at any error of the runtime (see [internals](../internals.md#exceptions)). Remove the function at the next seed refresh.
- In the compiler, some 37 constructions pass a field's usual value, as `Local(..., mutable: false, declared: false, used: false)`. After the next seed refresh, give those fields [defaults](../reference/objects.md) and leave the values out.

## Open questions

Questions of one area are in its file. These span areas:

- The scope of runtime type information (whether to keep field names).
