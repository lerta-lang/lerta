# Control flow

## Blocks and scopes

- An indented block holds statements, one per line.
- A name declared in a block (such as a loop variable) is visible only inside it. Declaring it again in the same block is an error.
- A declaration may have the name of one visible from an outer scope, a top-level name or a builtin (shadowing). Inside its block, the name refers to the new declaration. [Builtins](builtins.md) live outside every scope: inside `for print in 0...3`, `print` is the loop variable. A name of the module, top-level or imported, shadows a builtin type as well as a builtin value, in the whole module, as types and values share one namespace: after `Int := 1`, `x: Int` is an error, `'Int' is a value, not a type`, and after `class print`, `print(...)` constructs the class. A local shadows only the value: where a type is written, its name still names the type. What the language does through builtin types and interfaces, as literals, `for`, interpolation and `catch` do, does not go through the names that shadow them.

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
- `if name := value` and `while name := value` hold when the optional value is not nil; inside the body, `name` is the value without nil.
- An `if` with an `else` gives a value, that of the branch taken, as a `case` does (see [case](#case-without-a-subject)): `label := if v := m[key]`, followed by the branches on the lines below. It is written where a block literal may be (see [bracketless blocks](syntax.md#bracketless-blocks)), on the same line or the next, and as the last statement of a block. If any branch gives no value, as a block ending with an assignment, the `if` gives none either and is a statement; an `if` without an `else` never gives one.
- **Narrowing.** A `const`, a `var`, a parameter or a loop variable of type `T?` that a condition tests (`x`, `x != nil`, `not x` or `x == nil`, or `x == v` and `x != v` with a `v` that cannot be nil, as a literal or a value of a type that is not optional) has type `T` where it is known not to be nil, and one of a union type, optional or not, tested with `x is T` has type `T` where the test holds, and where it does not, the union of the other members (one alone is that member), optional if it was: in the `then` branch of `if x` (and the `then` value of `x then a else b`), in the `else` branch of `if not x`, and after a guard such as `return if x == nil` (an `if` with no `else` whose body ends with `return`, `break`, `continue`, `throw`, or an `if` whose branches both end so, or a `try` whose block and catches all end so or whose `finally` ends with a `throw`). `not` swaps where its operand holds and where it does not. In `a and b`, `b` is evaluated where `a` holds, and both narrow where the whole holds: `if x != nil and x > 0`. In `a or b`, `b` is evaluated where `a` does not hold, and both narrow where the whole does not: `return if x == nil or x < 0`. A `var` is narrowed where nothing may have assigned it since the test: an assignment to it ends its narrowing from there on, in every enclosing branch; a loop's condition and body do not see a test of it made outside the loop, as a round may assign it before the next, though a test inside narrows it there; a function literal sees it as declared, as it may run after an assignment; one that a function literal assigns is not narrowed anywhere, as the literal may run inside any call, and its value is taken with `if v := x` instead (names are matched without their scopes here, so a literal's own `var x` stops an outer `x` being narrowed too); and a `var` of a module's top level is not narrowed, as any function may assign it. The value of an assignment is read before it, where the `var` is still narrowed, while the target takes the declared type: `x = nil` is allowed where `x` is narrowed, and `x += 1` takes the declared type too. A path of fields is narrowed as a local is, `if box.item is A` then `box.item.x`, when it starts from such a local or from `@` and each field holds the same value while its object lives: a field of a struct or an anonymous struct, or a `const` one of a class. A member of an interface value is not, as a class's `var` field may stand for it.
- `break` leaves the innermost `while` or `for`, and `continue` goes on to its next round. Either is an error outside a loop.
- `break`, `continue` and `return` are expressions of type `never`, like `throw` (see [errors](errors.md)): `age := ages[name] ? return -1`, `when 'stop' then break`. Unlike `throw`, they may only be written where nothing evaluated before them is still held: as a statement, as the value of a declaration or of an assignment to a variable, and, within those, as the fallback of `?` or a value of `then`/`else` or of a `case` arm. Elsewhere, as in `f(x ? return 0)`, they are an error; so is a `return` inside an arm of a `case` that is itself such an operand, or a `break` or `continue` there that leaves a loop outside the arm. As a statement, `x ? return` is a guard, whose value is not used. [`yield`](functions.md#functions-that-yield), which gives no value, may only be a statement where `return` may be.
- **Postfix forms** `<statement> if <condition>` and `<statement> while <condition>` apply to one statement other than a declaration (`break if done`, `x *= 2 while x < 100`). The condition of a postfix `while` is evaluated first. A postfix condition may bind a name as those of `if` and `while` do, for the statement before it: `return local if local := lookup(name)`. A postfix form also follows a body on the same line as `->`, outside brackets (inside them, as in `[(x) -> x for x in xs]`, it belongs to the brackets' contents), and an arm's body on the same line.
- `and` and `or` evaluate their right operand only when the left one does not decide the result.
- Why the condition rules: the Ruby approach, constrained by types. There is no hook like `is_true`, so a type that is always true, such as `Int`, `String` or an array, is rejected rather than true (0 and the empty string are not false).
- Why there is no `unless`, no `&&`/`||`/`!`, no `then` statement and no `defer`: no forms that say the same thing two ways. `deinit` and `try`/`finally` replace `defer`; it may be considered if it becomes necessary.

## then and else

```
sign := n < 0 then 'negative' else n == 0 then 'zero' else 'positive'
label := name then "hello #{name}" else 'nobody'
greeting := name then "hello #{name}"
```

- `condition then a else b` is `a` if the condition holds, otherwise `b`; only the one chosen is evaluated. Without `else`, it is nil where the condition does not hold, so `name then "hello #{name}"` is a `String?`; an `else` goes with the nearest `then`. It is an expression only: both values must be values (not `void`). To run statements, write an `if`.
- The condition and its narrowing are those of `if`: in `name then ... else ...` above, `name` is a `String` in the `then` value.
- The values follow the rules of `case` arms (see below).
- Why `then` without `else` gives nil and an `if` without one gives no value: `then` is always a value, while an `if` is a statement too, as the last statement of a block, where a missing `else` giving nil would change what a block ending with an `if` gives.
- Why `?`, not `else` without `then`, gives the fallback of a nil (`x else y`, mirroring `c then a`): one `else` would then take two precedences, the weakest for `then`/`else` and a tighter one for `x ? 0 > 18` and `n ? 0 + 1`, and in `c then a else b else d` the last `else` could continue the `then` or take the fallback, which differ where `c` holds and `a` is nil. Only a guard, `ages[name] else return -1`, would read better.
- Why `c then a else b`, not `if c then a else b` on one line: `if c then a` would have to give nil, while an `if` without `else` gives no value, or require `else` and lose `name then greet(name)`; and `if c then x` as a statement would duplicate the postfix `x if c`. `a if c else b`, as in Python, cannot tell `x = a if c` from a postfix `if`.

## for and ranges

```
for i in 0...3
  print i
```

- `for <name> in <array>` runs its block for each item of the array, in order. The array's length is read before each round, so items pushed during the loop are visited too.
- `for <name> in <binary>` runs its block for each byte of a [`Binary`](types.md#binary), a `Byte`, in order.
- `for <name> in <iter>` runs its block for each item of an [`Iter`](types.md#iter), which starts its one traversal.
- `for <name> in <iterable>` runs its block for each item of the `Iter` that `iterable.iter()` gives, for a value of any other type that satisfies [`Iterable<T>`](builtins.md#iterable), as Python's `for` goes through `__iter__`.
- `for <name> in <start>...<end>` runs its block for each integer from `<start>` up to, but not including, `<end>`. If `<end>` is not greater than `<start>`, the block does not run.
- Both ends are `Int`s, evaluated once before the loop.
- The loop variable is a `const` `Int`.
- A range can only appear after `in` of a `for` or a comprehension, or as the index of a `Binary` (see [Binary](types.md#binary)), so far. `...` does not chain (`a...b...c` is an error).
- **Postfix `for`** `<statement> for <name> in <iterable>` runs one statement for each item, as a `for` block would: `print x for x in xs`. `when <condition>` after it runs the statement only for the items for which the condition holds: `total += x for x in xs when x > 0`. A `for` with a block has no `when`. A postfix `for` ends the arguments of a call without parentheses, as a line end would: `print x for x in xs` prints each `x`. Postfix forms apply from left to right.
- **Comprehensions** `[<element> for <name> in <iterable>]` make a new array of the element's value for each item, and `when <condition>` keeps only the items for which it holds: `[name + '!' for name in names when name]`. The condition narrows the loop variable in the element as an `if` would. The loop variable is only seen in the comprehension.
- **Index.** `for <name>, <index> in <iterable>` also names each item's place, an `Int` from 0, as CoffeeScript's `for` does: `print "#{i}: #{word}" for word, i in words`. For a range it counts from 0 too, not from the start. So do a postfix `for` and a comprehension, `[f(x, i) for x, i in xs]`, but not an Iter comprehension so far.
- **Tuples.** `for (<name>, <name>) in <iterable>` takes each item, a [tuple](types.md#tuples) of as many items, apart, as `(a, b) := item` would: `for (key, value) in pairs`. So do a postfix `for` and both kinds of comprehension, and an index may follow: `for (key, value), i in pairs`. Like the loop variable, the names need not be used.
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
- **Patterns in a block.** A line of `when` alone takes its patterns from the indented block below, written as the items of a [bracketless block](syntax.md#bracketless-blocks) are, and `then` follows at the indentation of `when`, with the body after it as it is after `else`: on its line or as an indented block.

  ```
  when
    'const', 'var', 'if', 'else',
    'while', 'for'
  then 'keyword'
  ```
- **Type patterns.** For a subject of a union type, a pattern names one of its types, or a [type alias](types.md#unions) of a union of some of them, which stands for each of those. In an arm, a subject that is a `const`, a parameter or a loop variable is narrowed to the type of its pattern, or to the union of the types of its patterns (whose common fields it reads, see [unions](types.md#unions)), and in the `else` arm to the types that no arm names, as where `x is T` does not hold. Without an `else` arm, every type of the union must be handled.
- **Value patterns.** For a subject of type `Int`, `Byte`, `Bool`, `String` or an [enum](types.md#enums), a pattern is a value, compared with `==`. The `else` arm is required, except for an enum when the patterns name every member; a member named twice is an error.
- **Optional subjects.** For a subject of type `T?`, the patterns are those for a `T`, and `nil`, which must be the only pattern of its arm. Without an `else` arm, `nil` must be handled too, and handling it twice is an error. In an arm of value patterns, and in the `else` arm once `nil` is handled, the subject is narrowed to `T` as with type patterns; in the `nil` arm, and the `else` arm otherwise, it is not.
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
- An arm's body follows `then` on the same line (`when c then x`; for `else`, directly: `else x`), or is an indented block on the next lines. On the same line, it is an expression, an assignment or a call without parentheses (`when '(' then depth += 1`), with the postfix forms of a statement (`when c then n += 1 if d`). `pass` alone on the same line is an arm that does nothing, which is `void`: `else pass` (`pass` is not a [keyword](syntax.md#operators)). A block is a scope; its last statement gives the arm's value if it is an expression.
- Why `when`: with it, patterns and `else` do not look alike. A `when` without a subject takes one condition, since several would read like `and`/`or` (write `or`).
  ```
  when n < 0
    magnitude := -n
    "minus #{magnitude}"
  ```
- An arm has no value (it is `void`) if it is a call to a `void` function or a block that ends with another statement, such as an assignment. It never gives a value (it is `never`) if it ends with `return`, `break`, `continue`, `throw`, or an `if` whose branches both end so.
- The type of the `case` is that of its arms, leaving out the arms that never give a value; a mix of `T`, `T?` and `nil` gives `T?`, and of a union and some of its members (a local narrowed in an arm), the union. Arms of other types give their union, when each type can be a member of one or is a union (see [unions](types.md#unions)), optional if an arm is: `'Fizz'` and `i` give an `Int | String`, and with `nil`, an `(Int | String)?`. Arms of types that cannot, as `Int` and `Int[]`, are an error, and so is a union that would bring together number types of different arms, as `Int` and `Float`, or an `Int8` and a literal typed as an `Int` before it, whatever other types it holds: it could not be used in arithmetic, so write the type where it is meant. An arm already of such a union, as a value of an `Int | Float`, may give it, wherever it is among the arms. Where a type is expected (an annotation, an argument), the arms are checked against it. If every arm is `void` (or `never`), the `case` has no value and can only stand as a statement; if every arm is `never`, the `case` never gives a value either.
