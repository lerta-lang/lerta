# Style

These conventions also cover features not implemented yet. The compiler does not check them (in the future, they will be handled by a lint the user can opt into). Whatever a formatter can align mechanically, the formatter aligns.

- **Naming**: variables, functions, methods, fields and module names are `snake_case`. Types, classes and interfaces are `PascalCase`. A `const` whose value is a literal (such as `MAX_SIZE = 100`) and an enum member are `SCREAMING_CASE`. A `const` holding a computed result is an ordinary variable and is `snake_case`. This matches C names imported through FFI naturally.
- **String literals**: use `'...'` whenever it can be written with `'...'`.
- **Inside `{}`**: put spaces (`{ x: 0, y: 1 }`, `import { a } from './m'`).
- **Generic extends**: no space between `extend` and its type parameters (`extend<T> Array<T>`), though the syntax allows one.
- **Empty collections**: `[]` rather than `Array<T>()`.
- **Multi-line literals**: where it can be written without brackets, write it without brackets.
- **Line length**: up to 100 columns per line.
- **Long lists**: a list that does not fit on one line (parameters, arguments, the items of an array or a map, the names of an import) goes on lines of its own inside the brackets, or in a bracketless block, each holding as many items as fit, except items that stand for lines of text, one per line (see [lines inside brackets](syntax.md#lines-inside-brackets)).
- **Modules**: a library module contains only code that builds the exported values. Put code to run in a separate entry file.
- **Calls without parentheses**: call a function or a method without parentheses at the start of a statement, the last expression of a body included (`write_group writer, item, indent`, `xs.push x`), wherever the language allows it (see [calls](syntax.md#calls)).
- **Implicit return**: end a function with its value (`x`), not `return x`; do not end a function returning nothing with a bare `return`.
- **Shorthand**: when the value of a named argument or a field is a variable of the same name, write the name alone: `Point(x, y: 2)`, `{ a }`.
- **Parentheses**: do not write parentheses that change nothing, except where another rule asks for them (Ranges, below), to clarify `and` mixed with `or`, around an `is` test under `not` (`not (x is T)`, which could be misread as `(not x) is T`), and around a `then`/`else` inside the `then` value of another (`a then (b then x else y) else z`), whose `else`s are hard to pair otherwise.
- **Postfix forms**: if the body of `while`/`for` is one statement, use the postfix form. If it exceeds 100 columns, use the block form even for one statement. Do not stack postfix forms (`x += 1 for x in xs while ok`).
- **Branches**: branch two ways with `if`/`else`, including for a value and on a subject (`if x is T`, `if kind == 'a'`), and three or more ways with `case`. A two-way `case` without `else` that handles every type or member of its subject (see [case with a subject](control-flow.md#case-with-a-subject)) stays a `case`: a type or member added later then fails to compile, where an `if` would take it to `else`. A two-way value that fits on one line is `c then a else b`. An `if` or a `case` whose branches are on the lines below starts a line of its own, one level deeper than the line that takes its value (`const x =`, then `case n` on the next line), where the grammar allows it (see [bracketless blocks](syntax.md#bracketless-blocks)).
- **Type bodies**: write type-only fields (constructor arguments) first, then those with a `default`. Do not write `const`/`var` when it equals the default.
- **Return types**: omit a return type that can be inferred. Write it where the language requires it (recursion, `nil` alone), and on generic functions and methods, whose bodies are checked only per instance.
- **Top-level order**: declare a top-level value above the code that uses it, wherever the order allows.
- **Unused names**: name an unused variable `_`.
- **Ranges**: parenthesize an end that is an operation (`0...(n - 1)`) for readability; `...` binds weaker than arithmetic, so the parentheses do not change the meaning.
- **Integer types**: quantities (counters, sizes, indexes, `length`) are `Int`. Unsigned types are only for bit operations, FFI and `Byte` (because `0 - 1` on a `UInt` passes silently).
