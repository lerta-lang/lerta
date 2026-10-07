# Syntax

## Basics

Source files, comments, identifiers, indentation and `'...'` strings are implemented: see [the reference](../reference/syntax.md).

- CoffeeScript-like. Indentation forms blocks. Implicit return. Expression-oriented.
- Numeric literals may use separators: `1_000_000`.
- Names starting with `_` produce no warning when unused.
- String literals besides `'...'`:
  - `"..."`: escapes (`\n` `\t` `\r` `\0` `\\` `\"` `\#` `\u{1F600}`) and interpolation `"#{name}"`.
  - Multi-line strings use `"""..."""`. The common leading indentation is removed, measured from the position of the closing `"""` (the Swift approach).

## Declarations

- Variable declarations are required: `const` (cannot be reassigned) / `var` (can be reassigned). `let` is not used.
  - This is the same at top level and inside functions, for values and for functions. It avoids ambiguity between declaration and assignment (the CoffeeScript pitfall).
  - Inside a type body the keyword may be omitted. Then methods default to `const` and fields to `var` (in a struct everything is `const`). Writing the keyword explicitly overrides the default (see [objects.md](objects.md#type-body-shared-by-class-and-struct)).
  - `const` only makes the binding immutable. Immutability of the contents is handled by types.
  - A type annotation is required only when the initial value does not determine the type, such as `nil` or an empty `[]` (`var x: Node | nil = nil`, `const xs: Array<Int> = []`).
  - For `var x: Type | nil` the initial value may be omitted; it defaults to nil.
- There is no function declaration (`def`). Only the form `const f = (x) -> ...`.
  - With no parameters, `()` may be omitted (`const f = -> ...`). The call `f()` cannot omit them.
  - Variadic parameters are `xs...`. Default parameter values are undecided.
- Destructuring `const { a, b } = obj` is supported.

## Multi-line literals

- **Newlines inside brackets**: inside list brackets (`[...]`, `{...}`, call `f(...)`), a newline separates elements (no comma needed). Inside grouping parentheses `(...)`, newlines are ignored and the content reads as the continuation of one expression.
  - Inside list brackets, one line is one element (a line starting with `-x` is a new element). To split an element over several lines, the element itself must open a block, or be wrapped in `(...)`.
- **Bracketless blocks**: an indented block may follow a trailing `=` or a trailing `key:`. Its content decides its kind.
  - All lines `identifier: value` → anonymous struct. All lines `expression: value` → Map. Anything else → array (one element per line). Mixing is an error.
  - If `key: value` lines follow a call, an anonymous struct is passed as the last argument (named arguments). There is no form that passes an array as an argument without brackets.
  - An array inside an array cannot be written without brackets (the element lines have no marker for the inner array).
  ```
  const config =
    name: 'lerta'
    targets:
      'linux'
      'macos'
    limits:
      depth: 64
      width: 100

  draw
    x: 10
    y: 20
  ```

## Calls without parentheses

`f x, y` is supported (the Nim command syntax approach). Rules:

1. Allowed **only at the start of a statement**. In the middle of an expression (`a + f x`, `g(f x)`), parentheses are required.
2. Arguments are taken **greedily to the end of the line** (the end of the line acts as the closing parenthesis).
3. There are no nested parenthesis-free calls. (`f g x` is an error; write `f g(x)`.)
4. **At the start of a statement, whitespace after an identifier marks the start of the arguments**: `f [1]` is `f([1])`, `f -1` is `f(-1)`, `f (a), b` is `f((a), b)`. Without whitespace it is `f[1]` (indexing) or `f(a)` (call). If there is also whitespace after the operator, as in `f - 1`, it is a binary operator. In the middle of an expression there are no parenthesis-free calls, so `x -1` is `x - 1`.
5. **A call with zero arguments requires parentheses**: `f()`. A bare `f` is the function value (functions are ordinary values, with one notation).
6. If the last argument is a closure, it may continue as an indented block.
7. A call with explicit type arguments requires parentheses: `f<T>(x)` (to avoid a clash with `a < b`).

- Parsing is decided purely by syntax. If `f` is not a function, the type checker rejects it.

## Operator precedence

From weakest: postfix `for` / postfix `if` / postfix `while` < parenthesis-free call < `then`/`else` < `?` < other binary operators

- `?` is the weakest binary operator (`a ? b + c` is `a ? (b + c)`).
- Comparison operators cannot be chained (`a < b < c` and `a < b > c` are syntax errors; use parentheses or `and`). Because of this, `f<T>(x)` always reads as a call with type arguments.
