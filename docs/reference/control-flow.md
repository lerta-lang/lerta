# Control flow

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
