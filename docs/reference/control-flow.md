# Control flow

## Blocks and scopes

- An indented block holds statements, one per line.
- A name declared in a block (such as a loop variable) is visible only inside it. Declaring it again in the same block is an error.
- A declaration may have the name of one visible from an outer scope, a top-level name or a builtin (shadowing). Inside its block, the name refers to the new declaration. Builtins (standard types, interfaces and built-in functions) live outside every scope: inside `for print in 0...3`, `print` is the loop variable.

## if and while

```
if n == 0
  print 'zero'
else if n < 0
  print 'negative'
else
  print 'positive'
while n > 0
  n -= 1
```

- A condition is a `Bool`, or an optional value, which holds when it is not nil (a `Bool?` holds when it is `true`). The operands of `and`, `or` and `not` follow the same rule.
- `if const name = value` and `while const name = value` hold when the optional value is not nil; inside the body, `name` is the value without nil.
- **Narrowing.** A `const`, a parameter or a loop variable of type `T?` that a condition tests (`x`, `x != nil`, `not x` or `x == nil`) has type `T` where it is known not to be nil, and one of a union type tested with `x is T` has type `T` where the test holds: in the `then` branch of `if x` (and the `then` value of `x then a else b`), in the `else` branch of `if not x`, and after a guard such as `return if x == nil` (an `if` with no `else` whose body ends with `return`, `break`, `continue`, `throw`, or an `if` whose branches both end so). A `var` is not narrowed, since it could be reassigned.
- `break` leaves the innermost `while` or `for`, and `continue` goes on to its next round. Either is an error outside a loop.
- `break`, `continue` and `return` are expressions of type `never`, like `throw` (see [errors](errors.md)): `const age = ages[name] ? return -1`, `when 'stop' then break`. Unlike `throw`, they may only be written where nothing evaluated before them is still held: as a statement, as the value of a declaration or of an assignment to a variable, and, within those, as the fallback of `?` or a value of `then`/`else` or of a `case` arm. Elsewhere, as in `f(x ? return 0)`, they are an error; so is a `return` inside an arm of a `case` that is itself such an operand, or a `break` or `continue` there that leaves a loop outside the arm. As a statement, `x ? return` is a guard, whose value is not used.
- **Postfix forms** `<statement> if <condition>` and `<statement> while <condition>` apply to one statement other than a declaration (`break if done`, `x *= 2 while x < 100`). The condition of a postfix `while` is evaluated first.
- `and` and `or` evaluate their right operand only when the left one does not decide the result. Their operands and `not`'s are `Bool`s.

## then and else

```
const sign = n < 0 then 'negative' else n == 0 then 'zero' else 'positive'
const label = name then "hello #{name}" else 'nobody'
```

- `condition then a else b` is `a` if the condition holds, otherwise `b`; only the one chosen is evaluated. It is an expression only: `else` is required, and both values must be values (not `void`). To run statements, write an `if`.
- The condition and its narrowing are those of `if`: in `name then ... else ...` above, `name` is a `String` in the `then` value.
- The values follow the rules of `case` arms (see below).

## for and ranges

```
for i in 0...3
  print i
```

- `for <name> in <array>` runs its block for each item of the array, in order. The array's length is read before each round, so items pushed during the loop are visited too.
- `for <name> in <binary>` runs its block for each byte of a [`Binary`](types.md#binary), a `UInt8`, in order.
- `for <name> in <iter>` runs its block for each item of an [`Iter`](types.md#iter), which starts its one traversal.
- `for <name> in <start>...<end>` runs its block for each integer from `<start>` up to, but not including, `<end>`. If `<end>` is not greater than `<start>`, the block does not run.
- Both ends are `Int`s, evaluated once before the loop.
- The loop variable is a `const` `Int`.
- A range can only appear after `in` of a `for` or a comprehension so far. `...` does not chain (`a...b...c` is an error).
- **Postfix `for`** `<statement> for <name> in <iterable>` runs one statement for each item, as a `for` block would: `print x for x in xs`. `when <condition>` after it runs the statement only for the items for which the condition holds: `total += x for x in xs when x > 0`. A `for` with a block has no `when`. A postfix `for` ends the arguments of a call without parentheses, as a line end would: `print x for x in xs` prints each `x`. Postfix forms apply from left to right.
- **Comprehensions** `[<element> for <name> in <iterable>]` make a new array of the element's value for each item, and `when <condition>` keeps only the items for which it holds: `[name + '!' for name in names when name]`. The condition narrows the loop variable in the element as an `if` would. The loop variable is only seen in the comprehension.
- **Lazy comprehensions** `(<element> for <name> in <iterable> when <condition>)`, in parentheses, are an [`Iter`](types.md#iter) of the same values, which evaluates nothing until it is consumed: each time it gives an item, it evaluates the condition for the iterable's next items until one holds, then the element for that item. The iterable itself is evaluated where the comprehension is, and the element and the condition see the values of the names around it as a [function literal](functions.md#function-literals) does: a `const`'s value then, and a `var` itself. An `Iter` iterable starts its traversal there.

## case with a subject

```
case e
  when Num then e.value
  when Add then eval(e.left) + eval(e.right)
  when Mul then eval(e.left) * eval(e.right)

case c
  when '+', '-' then 'additive'
  else 'other'
```

- The subject is evaluated once, and the first arm whose pattern matches is taken. An arm may list several patterns, separated by commas.
- **Type patterns.** For a subject of a union type, a pattern names one of its types. In an arm with one pattern, a subject that is a `const`, a parameter or a loop variable is narrowed to that type. Without an `else` arm, every type of the union must be handled.
- **Value patterns.** For a subject of type `Int`, `UInt8`, `Bool` or `String`, a pattern is a value, compared with `==`. The `else` arm is required.
- The arms' values follow the same rules as below.

## case without a subject

```
print case
  when i % 15 == 0 then 'FizzBuzz'
  when i % 3 == 0 then 'Fizz'
  else 'other'
```

- `case` is an expression. Its arms are in an indented block: one or more `when` arms, then an `else` arm, which is required.
- Each `when` is followed by a condition, as an `if`'s (a `Bool` or an optional value, which narrows a local in the arm's value). The conditions are evaluated from the top, and the first that holds is taken; if none does, the `else` arm is.
- An arm's value follows `then` on the same line (`when c then x`; for `else`, directly: `else x`), or is an indented block on the next lines. A block is a scope; its last statement gives the arm's value if it is an expression.
  ```
  when n < 0
    const magnitude = -n
    "minus #{magnitude}"
  ```
- An arm has no value (it is `void`) if it is a call to a `void` function or a block that ends with another statement, such as an assignment. It never gives a value (it is `never`) if it ends with `return`, `break`, `continue`, `throw`, or an `if` whose branches both end so.
- The type of the `case` is that of its arms, which must be the same, leaving out the arms that never give a value; a mix of `T`, `T?` and `nil` gives `T?`. Where a type is expected (an annotation, an argument), the arms are checked against it. If every arm is `void` (or `never`), the `case` has no value and can only stand as a statement; if every arm is `never`, the `case` never gives a value either.
