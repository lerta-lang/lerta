# Control flow

## Blocks and scopes

- An indented block holds statements, one per line.
- A name declared in a block (such as a loop variable) is visible only inside it.
- Declaring a name that is already visible from an outer scope (shadowing) is a warning. Inside the block, the name refers to the new declaration. A name starting with `_` produces no warning, to show that the shadowing is intended.
- Builtins (standard types, interfaces and built-in functions) live outside every scope and can be shadowed without a warning, so that adding a builtin does not affect existing code. Inside `for print in 0...3`, `print` is the loop variable.

## for and ranges

```
for i in 0...3
  print i
```

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
