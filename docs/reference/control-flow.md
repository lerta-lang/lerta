# Control flow

## Blocks and scopes

- An indented block holds statements, one per line.
- A name declared in a block (such as a loop variable) is visible only inside it. Declaring it again in the same block is an error.
- Declaring a name that is already visible from an outer scope (shadowing) is a warning. Inside the block, the name refers to the new declaration. A name starting with `_` produces no warning, to show that the shadowing is intended.
- A local that has the name of a top-level function shadows it, which is also a warning.
- Builtins (standard types, interfaces and built-in functions) live outside every scope and can be shadowed without a warning, so that adding a builtin does not affect existing code. Inside `for print in 0...3`, `print` is the loop variable.

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

- Conditions are `Bool`s.
- `break` leaves the innermost `while` or `for`, and `continue` goes on to its next round. Either is an error outside a loop.
- **Postfix forms** `<statement> if <condition>` and `<statement> while <condition>` apply to one statement other than a declaration (`break if done`, `x *= 2 while x < 100`). The condition of a postfix `while` is evaluated first.
- `and` and `or` evaluate their right operand only when the left one does not decide the result. Their operands and `not`'s are `Bool`s.

## for and ranges

```
for i in 0...3
  print i
```

- `for <name> in <array>` runs its block for each item of the array, in order. The array's length is read before each round, so items pushed during the loop are visited too.
- `for <name> in <start>...<end>` runs its block for each integer from `<start>` up to, but not including, `<end>`. If `<end>` is not greater than `<start>`, the block does not run.
- Both ends are `Int`s, evaluated once before the loop.
- The loop variable is a `const` `Int`.
- A range can only appear after `in` of a `for` so far. `...` does not chain (`a...b...c` is an error).

## case without a subject

```
print case
  when i % 15 == 0 then 'FizzBuzz'
  when i % 3 == 0 then 'Fizz'
  else 'other'
```

- `case` is an expression. Its arms are in an indented block: one or more `when` arms, then an `else` arm, which is required.
- Each `when` is followed by a `Bool` condition. The conditions are evaluated from the top, and the first true arm is taken; if none is, the `else` arm is.
- An arm's value follows `then` on the same line (`when c then x`; for `else`, directly: `else x`), or stands alone in an indented block on the next lines.
- All arms must have the same type, which is the type of the `case`. If they are calls to `void` functions, the `case` has no value and can stand as a statement.
