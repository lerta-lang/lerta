# Compiler

The planned changes to the structure of the compiler, which change no program's behavior. Each step keeps the generated IR the same, so that `bin/lerta dump-llvm` of every test and of `compiler/main.lerta`, before and after, shows any change; none needs a seed refresh. In this order:

## Resolutions in the checker's facts

The checker records what a member refers to (see [internals](../internals.md#overall-architecture)), but not what a name refers to, so codegen resolves names again: `generate_named_call` and `lookup_local` repeat the lookup of names with its shadowing, and `function_symbols` gathers the declarations, imports and builtins again. Each new kind of name adds a branch on both sides.

`NodeFacts` gets a table `references`, which takes in `enum_values`, and to which the checker writes where it resolves: from an `Identifier` to what it refers to, a local, a top-level value or function of a module, an extern, the constructor of a class or struct, `Map` or `Set`, or an enum value. `E.MEMBER`, an enum value that a member names, becomes a target of `members` with it.

Codegen only reads it, and no longer imports `checker/imports`. Then `ProgramWide.calls` and `functions_checked`, kept only for the formatter's `is_recursive`, give way to following `references`.

## Scalar descriptors

`SimpleType` holds only its kind, so codegen derives the representation of `Int`, `Byte`, `Float`, `Bool` and enums anew in each place with `is_kind`: the IR type, how it becomes a word, the compare predicates, the checked arithmetic, the item and key kinds, `zeroext`. A table in `compiler/codegen/scalar.lerta`, one row per type, gives them, so that the [sized numeric types](language.md#numeric-types) are rows rather than a branch in each place. The checker keeps its lists of kinds.
