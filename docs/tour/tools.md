# Tools

`lerta` is the one command for building, running and formatting programs.

| Command | Does |
|---|---|
| `lerta build hello.lerta -o hello -O` | Compiles a program into an executable, optimized with `-O`. |
| `lerta run hello.lerta -- <args>` | Compiles a program and runs it. |
| `lerta fmt --fix src` | Reformats the files in Lerta's standard style; without `--fix`, reports where they differ from it. |
| `lerta lsp` | The language server for editors. |

- A program is compiled with all its modules, the standard ones included, into one executable that needs no runtime installed.
- The debug build, without `-O`, checks memory as it runs: it reports the objects that leak, by type, when the program ends, and guards against errors in the compiler's own reference counting.
- `lerta fmt` lays out every program the same way, so code reviews never discuss layout.
- [editors/](../../editors/) has editor support for VS Code and Vim: syntax colors in both, and in VS Code and Neovim, errors as you type, go to definition, and formatting.

For every command and option, see [the compiler](../reference/compiler.md).

## Where to go next

- [examples/](../../examples/) has whole programs: a calculator, an HTTP server, a to-do list, and more.
- [The reference](../reference/README.md) has the rules of the language and its standard modules.
- [The philosophy](../philosophy.md) explains why Lerta is the way it is.
