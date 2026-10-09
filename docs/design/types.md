# Type system

- TypeScript-like: **local inference + bidirectional type checking**, with no global inference in the style of Crystal. What is inferred is in [the reference](../reference/functions.md).
- Union types and narrowing by control-flow analysis. Unions of classes and structs, `type` aliases, `is` and narrowing are implemented: see [the reference](../reference/types.md#unions). Planned: members other than classes and structs, where `?` binds tighter than `|` (`Int | String?` is `Int | (String?)`).
- Types and values share one namespace. The same name cannot be defined as both a type and a value in the same scope.
- `T?` is shorthand for `T | nil` (the Swift/Kotlin approach); unions remain the general form. `T?`, `nil` and nil tests are implemented: see [the reference](../reference/types.md#optional-values).
- There is only one `nil` (no `undefined`, no `null`: see [philosophy](../philosophy.md#non-goals)). JSON `null` is Lerta `nil`.
- `interface` uses structural typing (static duck typing). No `implements` declaration is needed.
- Generics are **monomorphized** (code is generated per type). Constraints are interfaces, as in `T: Comparable`, and are **checked at definition** (avoiding the C++ template "error deep inside").
  - Generic top-level functions with the bound `Stringable` are implemented, checked per instance instead: see [the reference](../reference/functions.md#generic-functions). So are generic methods of extends, classes and structs: see [the reference](../reference/objects.md#extend). Planned: checking their bodies at definition against the bounds, interfaces as bounds, generic classes and structs, and generic literals outside the top level.
- The checked downcast `x as Point` returns `Point?` (there is no separate form with `?`). There is no unchecked cast. To make failure an exception, write `(x as Point)!`.
  - If `x` has a type that can be nil, nil also counts as failure and returns nil (to distinguish, remove nil first with `if x`).
  - To take a narrowed value under another name, use `if const c = x as Circle`.
- Inside an interface, `Self` means "the type that implements it".
- Definite assignment analysis. A class cannot leak `this` before all fields are initialized.

## Type rules for conditions

Implemented: see [the reference](../reference/control-flow.md#if-and-while). Why: the Ruby approach, constrained by types. There is no hook like `is_true`, so a type that is always true, such as `Int`, `String` or an array, is rejected rather than true (0 and the empty string are not false).

## Numeric types

`Int`, `Byte`, their arithmetic and the typing of literals by context are implemented: see [the reference](../reference/types.md). Planned:

- `Int8/16/32`, `UInt16/32/64` and `Float`. The 64-bit signed integer and the unsigned 8-bit one have one name each, `Int` and `Byte`, rather than also `Int64` and `UInt8`, so that the common types have no second name to choose between.
- Overflow behavior is **decided by signedness** (the Ada modular type approach): signed types throw and unsigned types wrap around, as `Int` and `Byte` do. Since there are no implicit conversions, both operands always have the same type, and the rule for each operation is unique; no dedicated operators like `&+` are needed. For the rare case of wanting signed wraparound, use a method such as `x.wrapping_add(y)`.
- `/` between integers is the quotient, `Int: Div<Int, Int>` (see [operators](operators.md)). To divide as `Float`, convert explicitly. For an always non-negative remainder, use `x.mod(n)`.
