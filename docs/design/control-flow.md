# Control flow

## Expression orientation

`void` and `never`, `then`/`else`, `if`/`else` and `while` statements, the postfix forms, `break`/`continue`, `and`/`or`/`not`, nil tests, `?`, postfix `!` and declarations in conditions are implemented: see [the reference](../reference/control-flow.md). Why: no other forms that say the same thing two ways, so there is no `unless`, no `&&`/`||`/`!`, no `then` statement without `else`, and no `defer` (destructors and `try`/`finally` replace it; it may be considered if it becomes necessary). Planned:

- `if`/`else` with a value: a value however deeply nested, as `case` is, and `void` if any arm is `void`.
- `?.` is nil-safe access: `a?.b` (nil if `a` is nil, otherwise `a.b`).
- Narrowing a `var`.
- Code after a call to a function returning `never` (`exit`) is unreachable.
- Because `void` is not a type, generics cannot treat "returns a value / returns nothing" uniformly, and the standard library splits such functions, like `map` / `for_each`.

## Ranges

`a...b` in a `for` is implemented: see [the reference](../reference/control-flow.md#for-and-ranges). Planned:

- A range is a value of the built-in type `Range`, which can be traversed any number of times (unlike `Iter<T>`).
- Whether to also have a range that includes its end (`..`) is an [open question](../roadmap.md#open-questions).

## for and comprehensions

- Postfix `for`, `[...]` comprehensions with `when`, `(...)` comprehensions and `Iter<T>` with `map`/`filter`/`take` are implemented: see [the reference](../reference/control-flow.md#for-and-ranges) and [Iter](../reference/types.md#iter). Why: an `Iter` is not evaluated until consumed (the Rust approach; avoids CoffeeScript's implicit arrays and the intermediate-array problem of eager `map` in Ruby/JS); its protocol is `has_next()` / `next()`, since with `next(): T?` the end could not be distinguished when `T` is nilable; and a second traversal throws rather than silently becoming empty like a Python generator.
- Planned: more lazy methods of `Array` and `Iter<T>` besides `map`/`filter`/`take`.

## case

`case` with a subject, on types and on values, and without one are implemented: see [the reference](../reference/control-flow.md#case-with-a-subject). Why: with `when`, patterns and `else` do not look alike; and a `when` without a subject takes one condition, since several would read like `and`/`or` (write `or`).
