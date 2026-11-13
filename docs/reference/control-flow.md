# Control flow

## Blocks and scopes

- An indented block holds statements, one per line.
- A name declared in a block (such as a loop variable) is visible only inside it. Declaring it again in the same block is an error.

### Shadowing

- A declaration may take the name of one visible from an outer scope, a top-level name or a builtin. Inside its block, the name refers to the new declaration.
- [Builtins](builtins.md) live outside every scope: inside `for print in 0..3`, `print` is the loop variable.
- Types and values share one namespace. So a name of the module, top-level or imported, shadows a builtin type as well as a builtin value, in the whole module:
  - after `Int := 1`, `x: Int` is an error, `'Int' is a value, not a type`;
  - after `class print`, `print(...)` constructs the class.
- A local shadows only the value: where a type is written, its name still names the type.
- What the language does through builtin types and interfaces (literals, `for`, interpolation, `catch`) does not go through the names that shadow them.

## if and while

```lerta
if n == 0
  print 'zero'
else if n < 0
  print 'negative'
else
  print 'positive'
while n > 0
  print n
  n -= 1
unless done
  print 'more'
  done = true
until n >= 10
  print n
  n += 1
```

### Conditions

- A condition is a `Bool`, or an optional value other than a `Bool?`, which holds when it is not nil.
- A `Bool?` is compared instead, `flag == true`, as `if flag` would hide whether nil is meant to be false.
- The operands of `and`, `or` and `not` follow the same rule.
- `and` and `or` evaluate their right operand only when the left one does not decide the result.
- Why: the Ruby approach, constrained by types. There is no hook like `is_true`, so a type that is always true, such as `Int`, `String` or an array, is rejected rather than true (0 and the empty string are not false).
- Why there is no `&&`/`||`/`!`: no forms that say the same thing two ways.

### Binding a name

- `if name := value` and `while name := value` hold when the optional value is not nil; inside the body, `name` is the value without nil.

### unless and until

- `unless x` is `if not x`, and `until x` is `while not x`, in their postfix forms too (`return unless found`).
- An `unless` takes no `else`.
- Neither binds a name: `'unless' cannot bind a name`.
- Why: a negated condition reads better without `not`, `return unless found`. An `unless` with an `else` would read as a double negation, which `if` with the branches swapped avoids.
- [`lerta fmt`](style.md) writes `if not x` as `unless x` where it can, and `unless` as `if` where its condition is negated itself or an `and` or an `or`, so that each condition is written one way.

### if as a value

- An `if` with an `else` gives a value, that of the branch taken, as a [`case`](#case-without-a-subject) does: `label := if v := m[key]`, followed by the branches on the lines below.
- It is written where a block literal may be (see [bracketless blocks](syntax.md#bracketless-blocks)), on the same line or the next, and as the last statement of a block.
- If any branch gives no value, as a block ending with an assignment, the `if` gives none either and is a statement.
- An `if` without an `else` never gives a value.
- Why there is no `then` statement: see [then and else](#then-and-else).

### break, continue and return

- `break` leaves the innermost `while` or `for`, and `continue` goes on to its next round. Either is an error outside a loop.
- `break`, `continue` and `return` are expressions of type `never`, like [`throw`](errors.md#exceptions): `age := ages[name] ? return -1`, `when 'stop' then break`.
- Unlike `throw`, they may only be written where nothing evaluated before them is still held:
  - as a statement;
  - as the value of a declaration or of an assignment to a variable;
  - within those, as the fallback of `?`, a value of `then`/`else` or of a `case` arm.
- Elsewhere, as in `f(x ? return 0)`, they are an error. So is a `return` inside an arm of a `case` that is itself such an operand, or a `break` or `continue` there that leaves a loop outside the arm.
- As a statement, `x ? return` is a guard, whose value is not used.
- [`yield`](functions.md#functions-that-yield), which gives no value, may only be a statement where `return` may be.

### Postfix forms

- `<statement> if <condition>` and `<statement> while <condition>`, and those of `unless` and `until`, apply to one statement other than a declaration: `break if done`, `x *= 2 while x < 100`.
- The condition of a postfix `while` is evaluated first.
- A postfix condition may bind a name, as those of `if` and `while` do, for the statement before it: `return local if local := lookup(name)`.
- A postfix form also follows:
  - a body on the same line as `->`, outside brackets (inside them, as in `[(x) -> x for x in xs]`, it belongs to the brackets' contents);
  - an arm's body on the same line.

### Why there is no defer

`deinit` and `try`/`finally` replace it. It may be considered if it becomes necessary.

## Narrowing

A `const`, a `var`, a parameter or a loop variable takes a narrower type where a condition tests it.

### Tests

| Test | Where it holds | Where it does not |
|---|---|---|
| `x`, `x != nil` (`x: T?`) | `T` | `x` unchanged |
| `not x`, `x == nil` | `x` unchanged | `T` |
| `x == v` (`v` cannot be nil) | `T` | `x` unchanged |
| `x != v` | `x` unchanged | `T` |
| `x is T` (`x` of a union, optional or not) | `T` | the union of the other members (one alone is that member), optional if `x` was |
| `x is T` (`x` of an interface, optional or not) | `T` | `x` unchanged |

- `v` cannot be nil when it is a literal or a value of a type that is not optional.
- `not` swaps where its operand holds and where it does not.
- In `a and b`, `b` is evaluated where `a` holds, and both narrow where the whole holds: `if x != nil and x > 0`.
- In `a or b`, `b` is evaluated where `a` does not hold, and both narrow where the whole does not: `return if x == nil or x < 0`.

### Where narrowing applies

- in the `then` branch of `if x`, and the `then` value of `x then a else b`;
- in the `else` branch of `if not x`;
- in the body of `while x`, as its condition holds where each round starts;
- after a guard such as `return if x == nil`: an `if` with no `else` whose body ends with a statement that [never ends](errors.md#unreachable-code).

### Variables

A `var` is narrowed only where nothing may have assigned it since the test:

- An assignment to it ends its narrowing from there on, in every enclosing branch.
- A loop's condition and body do not see a test of it made outside the loop, as a round may assign it before the next. A test inside narrows it there.
- A function literal sees it as declared, as the literal may run after an assignment.
- In a function literal or a function, an `await` ends the narrowing of one declared outside it, as the code outside may run and assign it while the function waits. One it declares itself stays narrowed.
- One that a function literal or a method assigns is not narrowed anywhere, as it may run inside any call. Take its value with `if v := x` instead. Names are matched without their scopes here, so a literal's own `var x` stops an outer `x` being narrowed too.

The value of an assignment is read before it, where the `var` is still narrowed, while the target takes the declared type: `x = nil` is allowed where `x` is narrowed, and `x += 1` takes the declared type too.

### Paths of fields

- A path of fields is narrowed as a local is, `if box.item is A` then `box.item.x`, when
  - it starts from such a local or from `@`, and
  - each field holds the same value while its object lives: a field of a struct or an anonymous struct, or a class's field that is not `var`.
- A member of an interface value is not, as a class's `var` field may stand for it.

## then and else

```lerta
sign := n < 0 then 'negative' else n == 0 then 'zero' else 'positive'
label := name then "hello #{name}" else 'nobody'
greeting := name then "hello #{name}"
```

- `condition then a else b` is `a` if the condition holds, otherwise `b`. Only the one chosen is evaluated.
- Without `else`, it is nil where the condition does not hold: `name then "hello #{name}"` is a `String?`.
- An `else` goes with the nearest `then`.
- It is an expression only: both values must be values (not `void`). To run statements, write an `if`.
- The condition and its [narrowing](#narrowing) are those of `if`: above, `name` is a `String` in the `then` value.
- The values combine as the arms of a [`case`](#the-type-of-a-case) do.
- Why `then` without `else` gives nil, while an `if` without one gives no value: `then` is always a value, while an `if` is a statement too. As the last statement of a block, an `if` without `else` giving nil would change what the block gives.
- Why `?`, not `else` without `then` (`x else y`, mirroring `c then a`), gives the fallback of a nil:
  - one `else` would take two precedences, the weakest for `then`/`else` and a tighter one for `x ? 0 > 18` and `n ? 0 + 1`;
  - in `c then a else b else d`, the last `else` could continue the `then` or take the fallback, which differ where `c` holds and `a` is nil.

  Only a guard, `ages[name] else return -1`, would read better.
- `if c then a else b` with no block below it is an error that says to leave out `if`, as are `unless`, `while` and `until` before such a value.
- Why `c then a else b`, not `if c then a else b` on one line:
  - `if c then a` would have to give nil, while an `if` without `else` gives no value, or require `else` and lose `name then greet(name)`;
  - `if c then x` as a statement would duplicate the postfix `x if c`.
- Nor `a if c else b`, as in Python: it cannot tell `x = a if c` from a postfix `if`.

## for and ranges

```lerta
for i in 0..3
  square := i * i
  print square
```

### What for goes through

| `for x in <value>` | Runs its block for |
|---|---|
| an array | each item, in order. The length is read before each round, so items pushed during the loop are visited too. |
| a [`Binary`](types.md#binary) | each byte, a `Byte`, in order |
| an [`Iter`](types.md#iter) | each item; it starts the Iter's one traversal |
| any other [`Iterable<T>`](builtins.md#iterable) | each item of the `Iter` that `value.iter()` gives, as Python's `for` goes through `__iter__` |
| `<start>..<end>` | each integer from `<start>` up to, but not including, `<end>`; none if `<end>` is not greater than `<start>` |
| `<start>..=<end>` | the same, including `<end>` |

### Ranges

- `1..3` is `1` and `2`, as in Rust and as SQL's `>= 1 AND < 3`. `1..=3` is `1`, `2` and `3`, as SQL's `BETWEEN 1 AND 3`.
- `...` is no range; `a...b` is an error that says so. `...` spreads (see [array literals](types.md#array-literals)).
- Why Rust's `..` and `..=`, not CoffeeScript's and Ruby's `..` and `...`:
  - their `..` includes its end, which those used to Rust read as excluding it, and a range one item too long gives no error;
  - `..=` says that it includes its end;
  - the commonest range, which excludes it, is the shorter.
- Both ends are `Int`s, evaluated once before the loop. The loop variable is a `const` `Int`.
- A range can only appear, so far:
  - after `in`, of a `for`, a comprehension or a test (see [in](syntax.md#in));
  - as the index of an array or a `Binary` (see [Array](types.md#array)). Only an index takes one without a start or an end.
- Ranges do not chain: `a..b..c` and `a..=b..c` are errors.
- `a..=` without an end is an error, as including no end means nothing.

### Postfix for

- `<statement> for <name> in <iterable>` runs one statement for each item, as a `for` block would: `print x for x in xs`.
- `when <condition>` after it runs the statement only for the items for which the condition holds: `total += x for x in xs when x > 0`. A `for` with a block has no `when`.
- A postfix `for` ends a [call without parentheses](syntax.md#calls), as a line end would.
- Postfix forms apply from left to right.

### Comprehensions

- `[<element> for <name> in <iterable>]` makes a new array of the element's value for each item.
- `when <condition>` keeps only the items for which it holds: `[name + '!' for name in names when name]`. The condition narrows the loop variable in the element as an `if` would.
- The loop variable is only seen in the comprehension.

### Lazy comprehensions

- `(<element> for <name> in <iterable> when <condition>)`, in parentheses, is an [`Iter`](types.md#iter) of the same values, which evaluates nothing until it is consumed.
- Each time it gives an item, it evaluates the condition for the iterable's next items until one holds, then the element for that item.
- The iterable itself is evaluated where the comprehension is. An `Iter` iterable starts its traversal there.
- The element and the condition see the names around them as a [function literal](functions.md#function-literals) does: a `const`'s value then, and a `var` itself.

### Index

- `for <name> at <index> in <iterable>` also names each item's place, an `Int` from 0: `print "#{i}: #{word}" for word at i in words`.
  - Why a word rather than a comma, as in CoffeeScript's `for word, i`: Go's `for i, x` names the two the other way round, and a comma would let either reading compile wherever the items are `Int`s.
  - `at` is no keyword, so it stays usable as a name.
- For a range it counts from 0 too, not from the start.
- A postfix `for` and an array comprehension take one too, `[f(x, i) for x at i in xs]`; a lazy comprehension does not, so far.

### Tuples

- `for (<name>, <name>) in <iterable>` takes each item, a [tuple](types.md#tuples) of as many items, apart, as `(a, b) := item` would: `for (key, value) in pairs`.
- A postfix `for` and both kinds of comprehension take one too, and an index may follow: `for (key, value) at i in pairs`.
- Like the loop variable, the names need not be used.

## case with a subject

```lerta
case e
  when Num then e.value
  when Add then eval(e.left) + eval(e.right)
  when Mul then eval(e.left) * eval(e.right)

case c
  when '+', '-' then 'additive'
  else 'other'
```

- The subject is evaluated once, and the first arm whose pattern matches is taken.
- An arm may list several patterns, separated by commas.
- The arms' bodies and values are those of a [`case` without a subject](#case-without-a-subject).

### Patterns in a block

A line of `when` alone takes its patterns from the indented block below, written as the items of a [bracketless block](syntax.md#bracketless-blocks) are. `then` follows at the indentation of `when`, with the body after it as it is after `else`: on its line or as an indented block.

```lerta
case w
  when
    'const', 'var', 'if', 'else', 'while', 'unless', 'until', 'for', 'break', 'continue', 'return',
    'case'
  then 'keyword'
  else 'name'
```

### Type patterns

- For a subject of a union type, a pattern names one of its types, or a [type alias](types.md#unions) of a union of some of them, which stands for each of those. This does not apply once the subject is narrowed to a type of value patterns: a pattern that names a type is then an error.
- In an arm, a subject that is a `const`, a parameter or a loop variable is narrowed:
  - to the type of its pattern, or the union of the types of its patterns (whose common fields it reads, see [unions](types.md#unions));
  - in the `else` arm, to the types that no arm names, as where `x is T` does not hold.
- Without an `else` arm, every type of the union must be handled.

### Value patterns

- For a subject of type `Int`, a [sized integer](types.md#sized-integers), `Byte`, `Char`, `Bool`, `String` or an [enum](types.md#enums), a pattern is a value, compared with `==`.
- The `else` arm is required, except for an enum when the patterns name every member.
- A member named twice is an error.

### Optional subjects

- For a subject of type `T?`, the patterns are those for a `T`, and `nil`, which must be the only pattern of its arm.
- Without an `else` arm, `nil` must be handled too. Handling it twice is an error.
- The subject is narrowed to `T`, as with type patterns, in an arm of value patterns, and in the `else` arm once `nil` is handled. In the `nil` arm, and the `else` arm otherwise, it is not.

## case without a subject

```lerta
print case
  when i % 15 == 0 then 'FizzBuzz'
  when i % 3 == 0 then 'Fizz'
  else 'other'
```

- `case` is an expression. Its arms are in an indented block: one or more `when` arms, then an `else` arm, which is required.
- Each `when` is followed by a condition, as an `if`'s: a `Bool` or an optional value, which narrows a local in the arm's value.
- The conditions are evaluated from the top, and the first that holds is taken; if none does, the `else` arm is.
- Why `when`: with it, patterns and `else` do not look alike. A `when` without a subject takes one condition, since several would read like `and`/`or` (write `or`).

### Arms

- An arm's body follows `then` on the same line (`when c then x`; for `else`, directly: `else x`), or is an indented block on the next lines:
  ```lerta
  when n < 0
    magnitude := -n
    "minus #{magnitude}"
  ```
- On the same line, it is an expression, an assignment or a call without parentheses (`when '(' then depth += 1`), with the postfix forms of a statement (`when c then n += 1 if d`).
- `pass` alone on the same line, or alone in its block, is an arm that does nothing, which is `void`: `else pass` (see [pass](syntax.md#pass)).
- A block is a scope; its last statement gives the arm's value if it is an expression.
- An arm has no value (it is `void`) if it is a call to a `void` function or a block that ends with another statement, such as an assignment.
- An arm never gives a value (it is `never`) if it ends with `return`, `break`, `continue`, `throw`, or an `if` whose branches both end so.

### The type of a case

- The type of the `case` is that of its arms, leaving out the arms that are `never`.
- A mix of `T`, `T?` and `nil` gives `T?`. A mix of a union and some of its members (a local narrowed in an arm) gives the union.
- Arms of other types give their union, when each type can be a member of one or is a union (see [unions](types.md#unions)), optional if an arm is: `'Fizz'` and `i` give an `Int | String`, and with `nil`, an `(Int | String)?`.
- It is an error:
  - for arms of types that cannot be members, as `Int` and `Int[]`;
  - for a union that would bring together number types of different arms, as `Int` and `Float`, or an `Int8` and a literal typed as an `Int` before it, whatever other types it holds. It could not be used in arithmetic, so write the type where it is meant.
- An arm already of such a union, as a value of an `Int | Float`, may give it, wherever it is among the arms.
- Where a type is expected (an annotation, an argument), the arms are checked against it.
- If every arm is `void` (or `never`), the `case` has no value and can only stand as a statement. If every arm is `never`, the `case` never gives a value either.
