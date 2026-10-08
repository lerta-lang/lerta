# Style

These conventions also cover features not implemented yet. The compiler does not check them (in the future, they will be handled by a lint the user can opt into). Whatever a formatter can align mechanically, the formatter aligns.

- **Naming**: variables, functions, methods, fields and module names are `snake_case`. Types, classes and interfaces are `PascalCase`. A `const` whose value is a literal (such as `MAX_SIZE = 100`) is `SCREAMING_CASE`. A `const` holding a computed result is an ordinary variable and is `snake_case`. This matches C names imported through FFI naturally.
- **String literals**: use `'...'` whenever it can be written with `'...'`.
- **Inside `{}`**: put spaces (`{ x: 0, y: 1 }`, `import { a } from './m'`).
- **Empty collections**: `[]` rather than `Array<T>()`.
- **Multi-line literals**: where it can be written without brackets, write it without brackets.
- **Line length**: up to 100 columns per line.
- **Modules**: a library module contains only code that builds the exported values. Put code to run in a separate entry file.
- **Postfix forms**: if the body of `while`/`for` is one statement, use the postfix form. If it exceeds 100 columns, use the block form even for one statement. Do not stack postfix forms (`x += 1 for x in xs while ok`).
- **Type bodies**: write type-only fields (constructor arguments) first. Do not write `const`/`var` when it equals the default.
- **Members**: write `@x` and `@m()`; `@` alone is for passing the object as a value.
- **Unused names**: name an unused variable `_`.
- **Ranges**: parenthesize an end that is an operation (`0...(n - 1)`) for readability; `...` binds weaker than arithmetic, so the parentheses do not change the meaning.
- **Integer types**: quantities (counters, sizes, indexes, `length`) are `Int`. Unsigned types are only for bit operations, FFI and `Byte` (because `0 - 1` on a `UInt` passes silently).
