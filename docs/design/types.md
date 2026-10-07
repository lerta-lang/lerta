# Type system

- TypeScript-like. **Local inference + bidirectional type checking.** Function parameters are explicit (lambdas may omit them when there is an expected type). Return values and locals are inferred (the return type of a recursive function is explicit). No global inference in the style of Crystal.
- Union types, and narrowing by control-flow analysis (`T` only inside `if x != nil`).
- Types and values share one namespace. The same name cannot be defined as both a type and a value in the same scope.
- Standard types, interfaces and built-in functions (builtins) live in the outermost scope, and user definitions can shadow them (so additions to the standard library do not break existing code). Shadowing a builtin produces no warning, for the same reason.
- Declaring a name in an inner scope that is already declared by the user in an outer scope (shadowing) produces a warning. Until warnings are implemented, stage0 rejects it as an error.
- `type Expr = Num | Plus | Neg` names a type (an alias).
- Discriminated unions are unions of classes. The discriminator is the class type itself (no `kind` field, no enum; branch with `case`).
- Type notation: function types `(Int, String) -> Bool` (no parameters `() -> Int`, no return value `(Int) -> void`), generics `Array<Int>`, `Map<String, Int>`.
  - `?` binds tighter than `|` (`Int | String?` is `Int | (String?)`). To make a function type nilable, write `(() -> Int)?`.
- Lambda parameter types may be omitted where the expected type is known (`xs.map (x) -> x * 2`).
- `T?` is shorthand for `T | nil` (the Swift/Kotlin approach). Unions remain the general form.
- There is only one `nil` (no `undefined`, no `null`). JSON `null` is Lerta `nil`. `nil` is a type with one element. "No key" is distinguished with `m.has(k)`.
- There is **no** `any`.
- `interface` uses structural typing (static duck typing). No `implements` declaration is needed.
- Generics are **monomorphized** (code is generated per type). Constraints are interfaces, as in `T: Comparable`, and are **checked at definition** (avoiding the C++ template "error deep inside").
- The checked downcast `x as Point` returns `Point?` (there is no separate form with `?`). There is no unchecked cast. To make failure an exception, write `(x as Point)!`.
  - If `x` has a type that can be nil, nil also counts as failure and returns nil (to distinguish, remove nil first with `if x`).
- Inside an interface, `Self` means "the type that implements it".
- The type test `x is Circle` returns `Bool` and narrows `x` to `Circle` on the then side. To take the value under another name, use `if const c = x as Circle`.
- Definite assignment analysis. A class cannot leak `this` before all fields are initialized.

## Type rules for conditions

These follow the Ruby approach, constrained by types.

- The condition of `if` / `then` / `while` / postfix `if` / postfix `while` may only be **`Bool` or `T?`**.
- `T?` is a **nil test** (`if node` ≡ `node != nil`, narrowed to `T` on the then side). For `Bool?`, both `nil` and `false` are false.
- Types that are always true, such as `Int`, `String` and `Array`, are a **compile error** (0 and the empty string are not false; there is no hook like `is_true`).
- The operands of `and` / `or` / `not` follow the same rule, and the result is `Bool`. For `T?`, `not x` is `x == nil`.

## Numeric types

`Int` and its arithmetic are implemented: see [the reference](../reference/types.md).


- `Int8/16/32/64`, `UInt8/16/32/64`, `Int` (an alias of Int64), `Float`.
- **No implicit conversions** (`UInt8 + Int` is an error). The type of a literal is decided by context.
  - A one-byte string literal becomes a `Byte` when the expected type is `Byte` (`c >= '0'`, `"\n"` in `case c`). Without an expected type it is a `String`. Using two or more bytes as a `Byte` is an error.
- Overflow behavior is **decided by signedness** (the Ada modular type approach).
  - `Int`, `Int8` to `Int64`: **throw** (exception).
  - `UInt8` to `UInt64`, `Byte`: **wraparound**.
  - Since there are no implicit conversions, both operands always have the same type, and the rule for each operation is unique. No dedicated operators like `&+` are needed.
  - For the rare case of wanting signed wraparound, use a method such as `x.wrapping_add(y)`.
  - For the convention on which integer type to use for quantities, see [the style guide](../reference/style.md).
- **`/` between integers is the quotient** (`Int: Div<Int, Int>`). The remainder is `%`. To divide as `Float`, convert explicitly.
  - The quotient truncates toward zero (same as C / Go / Rust: `-7 / 2 == -3`, `-7 % 2 == -1`). For an always non-negative remainder, use `x.mod(n)`.
- Division by zero throws.
