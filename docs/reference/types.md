# Types

## Int

- `Int` is a signed 64-bit integer.
- A literal must fit in `Int`, including its sign (`-9223372036854775808` is the minimum).
- `+` `-` `*` and prefix `-` throw `integer overflow` when the result does not fit.
- `/` is the quotient, truncated toward zero, and `%` is the remainder (`-7 / 2 == -3`, `-7 % 2 == -1`). Both throw `division by zero` when the divisor is 0, and `integer overflow` for the minimum value divided by `-1`.
