# Syntax

## Basics

Source files, comments, identifiers, indentation, integer literals and `'...'` strings are implemented: see [the reference](../reference/syntax.md).

- CoffeeScript-like. Indentation forms blocks. Implicit return. Expression-oriented.
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

The basic rules are implemented: see [the reference](../reference/syntax.md#calls). Planned:

- Whitespace after an identifier at the start of a statement also starts the arguments before `[`: `f [1]` is `f([1])`, while `f[1]` is indexing.
- If the last argument is a closure, it may continue as an indented block.
- A call with explicit type arguments requires parentheses: `f<T>(x)` (to avoid a clash with `a < b`).

## Operator precedence

From weakest: postfix `for` / postfix `if` / postfix `while` < parenthesis-free call < `then`/`else` < `?` < other binary operators

- `?` is the weakest binary operator (`a ? b + c` is `a ? (b + c)`).
- The other binary operators (the arithmetic ones are implemented: see [the reference](../reference/syntax.md#operators)), from weakest: `or` < `and` < `not` (prefix) < comparisons (`==` `!=` `<` `<=` `>` `>=`, `is`) < range `...` < `+` `-` < `*` `/` `%` < prefix `-`. All binary operators except `then`/`else` are left-associative.
- Comparison operators cannot be chained (`a < b < c` and `a < b > c` are syntax errors; use parentheses or `and`). Because of this, `f<T>(x)` always reads as a call with type arguments.
