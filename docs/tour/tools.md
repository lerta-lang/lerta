# Tools

`lerta` is the one command for building, running and formatting programs.

| Command | Does |
|---|---|
| `lerta build hello.lerta -o hello -O` | Compiles a program into an executable, optimized with `-O`. |
| `lerta run hello.lerta -- <args>` | Compiles a program and runs it. |
| `lerta fmt --fix src` | Lays out the files in the style; without `--fix`, reports where they differ. |
| `lerta lsp` | The language server for editors. |

- A program is compiled with all its modules, the standard ones included, into one executable that needs no runtime installed.
- The debug build, without `-O`, checks memory as it runs: it stops a use of a freed object, and reports the objects leaked, by type, when the program ends.
- `lerta fmt` lays out every program one way, so code reviews never discuss layout.
- [editors/](../../editors) has the support for VS Code and Vim: colors, errors as you type, going to definitions, and formatting.

For every command and option, see [the compiler](../reference/compiler.md).

## Where to go next

- [examples/](../../examples) has whole programs: a calculator, an HTTP server, a to-do list, and more.
- [The reference](../reference/README.md) has the rules of the language and its standard modules.
- [The philosophy](../philosophy.md) tells why Lerta is as it is.
