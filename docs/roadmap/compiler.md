# Compiler

The planned changes to the structure of the compiler, which change no program's behavior. Each step keeps the generated IR the same, so that `bin/lerta dump-llvm` of every test and of `compiler/main.lerta`, before and after, shows any change; none needs a seed refresh. In this order:

## Calls by references

`ProgramWide.calls` and `functions_checked`, kept only for the formatter's `is_recursive`, give way to following the references that the checker records (see [internals](../internals.md#overall-architecture)).

## Scalar descriptors

`SimpleType` holds only its kind, so codegen derives the representation of `Int`, `Byte`, `Float`, `Bool` and enums anew in each place with `is_kind`: the IR type, how it becomes a word, the compare predicates, the checked arithmetic, the item and key kinds, `zeroext`. A table in `compiler/codegen/scalar.lerta`, one row per type, gives them, so that the [sized numeric types](language.md#numeric-types) are rows rather than a branch in each place. The checker keeps its lists of kinds.
