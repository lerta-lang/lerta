# Syntax

- Source files use the extension `.lerta`. Lines end with LF or CRLF.
- Comments run from `#` to the end of the line. There are no block comments.
- Identifiers are `[A-Za-z_][A-Za-z0-9_]*` (ASCII only).
- Integer literals are decimal or hexadecimal. In a decimal one, `_` may separate digits (`1_000_000`), and a leading zero is not allowed except in `0` itself, so `010` is not mistaken for octal. A hexadecimal one is `0x` followed by one or more digits `0-9`, `a-f` or `A-F`, with no `_` (`0xFF`, `0x7fffffffffffffff`). Both have the same types and limits (see [Int](types.md#int)). Where a prefix `-` may appear, a `-` directly followed by an integer literal is part of the literal (`-1`); otherwise it is the prefix operator. After an operand, `-` is always subtraction (`x-1`, `1 -1`).
- `'...'` string literals have no escapes and no interpolation. They are single line only and cannot contain `'`.
- `"..."` string literals are single line and have escapes, `\n` `\t` `\r` `\0` `\\` `\"` `\#` and `\u{1F600}` (a code point in hex, not a surrogate), and interpolation `"#{expression}"`, which inserts the value's text, `expression.to_string()` (see [Stringable](builtins.md#stringable)). An interpolated expression cannot contain a function literal.

## Indentation

- Indentation forms blocks. It is made of **spaces only**; a tab in indentation is a compile error.
- A line that is empty, or contains only spaces and optionally a comment, is ignored, whatever its indentation.
- A line indented less than the previous one must return to the indentation of an enclosing block.

## Lines inside brackets

```
const keywords = [
  'const'
  'var', 'if'
]
print add(
  1
  2
)
const total = (1 +
  2)
```

- Lines inside brackets, `(` `[` `{`, continue the line that opened them, whatever their indentation, until the brackets close. The `<` `>` of type arguments are not brackets.
- In a list (the brackets of an array or a map, the parentheses of a call's arguments or of a function's parameters, the braces of an import), a line end separates items as a comma does. Items on one line are separated by commas; a comma must be followed by an item on the same line, so neither the last item nor a line ends with one.
- In grouping parentheses and an index, `xs[i]`, lines simply continue the expression.
- So far, an item inside brackets cannot open an indented block (a `case`, a function body).

## Bracketless blocks

```
const config =
  name: 'lerta'
  targets:
    'linux'
    'macos'
draw 'p'
  x: 10
  y: 20
```

- After a trailing `=` (of a declaration, an assignment or a field), a trailing `key:` or a `return`, an indented block on the next lines is a literal. Its items, one or more on each line separated by commas as inside brackets, decide its kind: all `name: value` make an anonymous struct, all `key: value` (a key that is not a name) a map, and all plain values an array. Mixing them is an error. A value may take the lines below, as an `if`, a `case` or a function literal does. A block of one plain value is that value itself, not an array of it, so that a value can start on the next line; an array of one item is written `[x]`.
- A statement that is a call, a name or a method, followed by an indented block whose first line is `name: value` gives the block as its named arguments (see [anonymous structs](types.md#anonymous-structs)). An array cannot be passed this way, and an array inside an array cannot be written without brackets.

## Declarations and assignment

- `const name = value` declares a name that cannot be reassigned; `var name = value` one that can. The type is the type of the value, or the one written after the name (`const xs: Array<Int> = []`).
- `name = value` assigns to a `var`, and `xs[i] = value` to an item of an array. `+=` `-=` `*=` `/=` `%=` combine an `Int` `var` with an `Int` value, and `+=` also appends a `String` to a `String`.
- An assignment is a statement, not an expression.
- Why: there is no `let` and no function declaration (`def`), so that declarations look the same at the top level, inside functions and in type bodies, for values and for functions, which avoids the CoffeeScript ambiguity between declaration and assignment. `const` only makes the binding immutable, since immutability of the contents is handled by types.

## Statements

- One statement per line. A statement is an expression; see [discarded values](errors.md#discarded-values) for which expressions may stand alone.

## Calls

- `f(x, y)` calls `f`. The `(` must follow the callee without whitespace.
- **Calls without parentheses** (the Nim command syntax approach): `f x, y`. The callee is a name or `@name`, followed by any number of `.name`, all without spaces: `xs.push x`, `@lines.push line`.
  1. Allowed **only at the start of a statement**. In the middle of an expression (`g(f x)`), parentheses are required.
  2. Arguments are taken **greedily to the end of the line**, or to a postfix `if`, `while` or `for`, which applies to the whole call: `print x if done` is `(print x) if done`, while `f a then b else c` passes `a then b else c`.
  3. There are no nested parenthesis-free calls. (`f g x` is an error; write `f g(x)`.)
  4. At the start of a statement, whitespace after the callee marks the start of the arguments: `f (a), b` is `f((a), b)`, while `f(a)` is a call with parentheses. `f -1` is `f(-1)`; if there is also whitespace after the operator, as in `f - 1`, it is a binary operator. In the middle of an expression there are no parenthesis-free calls, so `x -1` is `x - 1`.
  5. **A call with zero arguments requires parentheses**: `f()`. A bare `f` is the function value.
  6. If the last argument is a function literal, its body may continue as an indented block on the next lines: `each xs, (x) ->` followed by the body. With parentheses it cannot, as an item inside brackets cannot open a block (see [lines inside brackets](#lines-inside-brackets)).
- Parsing is decided purely by syntax. If `f` is not a function, the type checker rejects it.
- `(x)` groups an expression.
- Arguments may be named, `f(name: value)`, after the positional ones: those of a constructor and the fields of an [anonymous struct](types.md#anonymous-structs) parameter.
- `x.name()` calls a method of `x`, `x.name` reads a property and `xs[i]` indexes. As with `(`, no space is allowed before `.` or `[`. At the start of a statement, `f [1]` is the call `f([1])`.
- Types are written as names, with type arguments in `<>` and `?` for an optional type: `Int`, `Array<String>`, `String?`.
- `x!` unwraps an optional value; no space is allowed before `!`. `x?.name` reads a member of an optional value (see [optional values](types.md#optional-values)); no space is allowed before `?` or `.`.

## Operators

From weakest: `then`/`else` < `?` (nil coalescing) < `or` < `and` < prefix `not` < comparisons (`==` `!=` `<` `<=` `>` `>=`, `is` and `as`) < range `...` < `+` `-` < `*` `/` `%` < prefix `-`.

- Arithmetic operators are left-associative (`10 - 4 - 3` is `3`). `then`/`else` and `?` are right-associative: `a then x else b then y else z` is `a then x else (b then y else z)`.
- Comparisons, `is` and `as` included, cannot be chained: `a < b < c` is a syntax error; use parentheses, as in `(x as T?) == nil`.
- `as` binds as comparisons do, weaker than `.`: a member of a cast is read as `(x as T!).name`.
- `true` `false` `nil` `and` `or` `not` `const` `var` `if` `else` `while` `for` `in` `break` `continue` `return` `case` `when` `then` `class` `struct` `throw` `import` `export` `extern` `extend` `enum` are keywords (`from` and `pass` are not) and cannot be used as names.
