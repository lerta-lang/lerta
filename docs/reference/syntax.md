# Syntax

- Source files use the extension `.lerta`. Lines end with LF or CRLF.
- Comments run from `#` to the end of the line. There are no block comments.
- Identifiers are `[A-Za-z_][A-Za-z0-9_]*` (ASCII only).
- Integer literals are decimal. `_` may separate digits (`1_000_000`). A leading zero is not allowed except in `0` itself, so `010` is not mistaken for octal. Where a prefix `-` may appear, a `-` directly followed by an integer literal is part of the literal (`-1`); otherwise it is the prefix operator. After an operand, `-` is always subtraction (`x-1`, `1 -1`).
- `'...'` string literals have no escapes and no interpolation. They are single line only and cannot contain `'`.

## Indentation

- Indentation forms blocks. It is made of **spaces only**; a tab in indentation is a compile error.
- A line that is empty, or contains only spaces and optionally a comment, is ignored, whatever its indentation.
- A line indented less than the previous one must return to the indentation of an enclosing block.

## Statements

- One statement per line. A statement is an expression; see [discarded values](errors.md#discarded-values) for which expressions may stand alone.

## Calls

- `f(x, y)` calls `f`. The `(` must follow the callee without whitespace.
- **Calls without parentheses** (the Nim command syntax approach): `f x, y`.
  1. Allowed **only at the start of a statement**. In the middle of an expression (`g(f x)`), parentheses are required.
  2. Arguments are taken **greedily to the end of the line**.
  3. There are no nested parenthesis-free calls. (`f g x` is an error; write `f g(x)`.)
  4. At the start of a statement, whitespace after an identifier marks the start of the arguments: `f (a), b` is `f((a), b)`, while `f(a)` is a call with parentheses. `f -1` is `f(-1)`; if there is also whitespace after the operator, as in `f - 1`, it is a binary operator. In the middle of an expression there are no parenthesis-free calls, so `x -1` is `x - 1`.
  5. **A call with zero arguments requires parentheses**: `f()`. A bare `f` is the function value.
- Parsing is decided purely by syntax. If `f` is not a function, the type checker rejects it.
- `(x)` groups an expression.

## Operators

From weakest: comparisons (`==` `!=` `<` `<=` `>` `>=`) < range `...` < `+` `-` < `*` `/` `%` < prefix `-`.

- Arithmetic operators are left-associative (`10 - 4 - 3` is `3`).
- Comparisons cannot be chained: `a < b < c` is a syntax error; use parentheses.
- `true`, `false`, `case`, `when`, `then`, `else`, `for` and `in` are keywords and cannot be used as names.
