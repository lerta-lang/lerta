# Syntax

## Basics

Source files, comments, identifiers, indentation, integer literals, `'...'`/`"..."` strings and implicit return are implemented: see [the reference](../reference/syntax.md). Planned:

- Multi-line strings use `"""..."""`. The common leading indentation is removed, measured from the position of the closing `"""` (the Swift approach).

## Declarations

`const`/`var` with an initial value, assignment and destructuring are implemented: see [the reference](../reference/syntax.md#declarations-and-assignment). Why: there is no `let` and no function declaration (`def`), so that declarations look the same at the top level, inside functions and in type bodies, for values and for functions, which avoids the CoffeeScript ambiguity between declaration and assignment; and `const` only makes the binding immutable, since immutability of the contents is handled by types. Planned:

- For `var x: T?` the initial value may be omitted; it defaults to nil.
- Variadic parameters are `xs...`. Default parameter values are an [open question](../roadmap.md#open-questions).

## Multi-line literals

Newlines inside brackets and bracketless blocks are implemented: see [the reference](../reference/syntax.md#lines-inside-brackets). Planned beyond that:

- An item inside brackets may open an indented block; otherwise, to split an item over several lines, wrap it in `(...)`.

## Calls without parentheses

The rules, and a last argument that is a function literal continuing as an indented block, are implemented: see [the reference](../reference/syntax.md#calls).

## Operator precedence

The precedence and associativity of the implemented operators are in [the reference](../reference/syntax.md#operators).

