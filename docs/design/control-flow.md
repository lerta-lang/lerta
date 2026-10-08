# Control flow

## Expression orientation

- **Some statements have values and some do not.**
  - Statements without a value (`void`): `for`, `while`, assignment, `if` without `else`, postfix `if`/`while`/`for` (other than comprehensions).
  - Expressions with a value: `if`/`else`, `case` (see below), and so on. They are values however deeply nested. But if any arm is `void`, the whole is `void`.
  - Using `void` as a value is an error.
  - The implicit return is the value of the last statement in the function body. If that is `void`, the function returns no value.
- `void` is a special marker with no value and no type (distinct from `nil`). It cannot be used as a type. It may only be written in the return position of a function (`(x: Int): void`, `(Int) -> void`). `T | void` and `Array<void>` cannot be formed.
  - Because of this, generics cannot treat "returns a value / returns nothing" uniformly, and the standard library splits such functions, like `map` / `for_each`.
- `never` means "does not return" (close to Rust's `!`; it takes only the "does not return" use of TypeScript's `never`). Like `void`, it may only be written in the return position.
  - `throw`/`return`/`break`/`continue` are expressions of type `never`: implemented, see [the reference](../reference/control-flow.md#if-and-while).
  - When the types of arms are combined, `never` arms are ignored. Code after a call to a function returning `never` (`exit`) is unreachable.
- The `then`/`else` expression `cond then a else b` is implemented: see [the reference](../reference/control-flow.md#then-and-else).
- `if`/`else` and `while` statements, postfix `if`/`while`, `break`/`continue` and `and`/`or`/`not` are implemented: see [the reference](../reference/control-flow.md#if-and-while). Nil tests in conditions, `?`, postfix `!` and declarations in conditions are implemented too. Planned beyond that: `if`/`else` with a value, `?.`, and narrowing a `var`.
- **Postfix `if`** `continue if z < 0` is **statement only, with no `else`** (for guards). There is no `then` statement without `else`, such as `cond then f()`.
- Division of roles: use `then` when you want a value, postfix `if` when you want to skip, block `if`/`else` when it is long. Choose between postfix `while`/`for` and the block form by the length of the body (postfix for one statement; see [the style guide](../reference/style.md)). No other forms that say the same thing two ways. There is no `unless`.
- **Postfix `while`** `@pos += 1 while @pos < n` is statement only. The condition is evaluated first (there is no "run at least once" like Ruby's `begin ... end while`).
- **`?` is nil coalescing**: `x ? "default"` (instead of `??`; the only coalescing operator).
- **`?.` is nil-safe access**: `a?.b` (nil if `a` is nil, otherwise `a.b`).
- **Postfix `!`** turns `T?` into `T`. If nil, it throws (it is not unsafe; it marks "this may throw here").
- Declarations in conditions are allowed: `while const line = reader.read_line()`, `if const node = find(x)` (false if the `T?` is nil; `T` in the body; scoped to the body only).
  - Assignment is `void`, so it cannot be a condition (`while x = ...` is an error).
- Logical operators are the keywords **`and` / `or` / `not`**, with short-circuit evaluation. There is no `&&`, `||` or prefix `!` (for operand type rules see [types.md](types.md#type-rules-for-conditions)).
- There is **no** `defer`. Destructors (RAII) and try/finally replace it. It may be considered if it becomes necessary.

## Ranges

`a...b` in a `for` is implemented: see [the reference](../reference/control-flow.md#for-and-ranges). Planned:

- A range is a value of the built-in type `Range`, which can be traversed any number of times (unlike `Iter<T>`).
- Whether to also have a range that includes its end (`..`) is an [open question](../roadmap.md#open-questions).

## for and comprehensions

- Postfix `for` and `[...]` comprehensions with `when` are implemented: see [the reference](../reference/control-flow.md#for-and-ranges). `Iter<T>` is not yet.
- **`(f(x) for x in xs)`**: wrapped in parentheses it is an `Iter<T>` (a lazy iterator). It is not evaluated until consumed (the Rust approach; avoids CoffeeScript's implicit arrays and the intermediate-array problem of eager `map` in Ruby/JS).
- `map`/`filter`/`take` and so on of `Array` also return `Iter<T>` (lazy chains).
- The `Iter<T>` protocol is `has_next()` / `next()` (with `next(): T?`, the end could not be distinguished when `T` is nilable).
- **Cannot be traversed again.** A second traversal throws (it does not silently become empty like a Python generator). To use it several times, materialize it with `.to_array()`.

## case

```
const eval = (e: Expr): Int ->
  case e
    when Num then e.value
    when Plus then eval(e.left) + eval(e.right)
    when Neg
      const v = eval(e.operand)
      -v
```

- Arms (`when pattern then expression`, an indented block, and the `else` arm) are implemented: see [the reference](../reference/control-flow.md#case-without-a-subject). Because of `when`, patterns and `else` do not look alike.
- If the pattern is a type, it branches on the type and narrows the subject inside the arm (the same rule as `is`). If it is a value, it compares with `==` (several allowed, like `"+", "-"`).
  - Syntactically a pattern is an expression. Name resolution decides whether it is a type or a value.
- `case` with a subject, on types (unions of classes and structs) and on values, is implemented: see [the reference](../reference/control-flow.md#case-with-a-subject).
- **`case` without a subject** is implemented: see [the reference](../reference/control-flow.md#case-without-a-subject). Several conditions separated by commas are not allowed (they would read like `and`/`or`; write `or`). Use it when you want a value from a chain of conditions; an `if`/`else` statement is for statements.
- When branching on types, not handling every type of the union is a compile error (exhaustiveness check). Not needed if there is an `else`. When branching on values, `else` is required.
