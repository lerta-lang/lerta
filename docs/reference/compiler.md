# Compiler

```
lerta build <source> [<file>...] [-o <output>] [-O] [--target <triple>]
```

builds an executable. `lerta` is `bin/lerta`, which `make` builds (see the [README](../../README.md)); it carries the standard modules and the runtime in it, so it needs no other file of the repository. Arguments that do not fit this usage (an unknown or repeated option, a missing source, a file after it of another kind than below, a value that starts with `-`, or, without `-o`, a source whose name does not end with `.lerta`) print the usage to stderr and exit with code 2.

- `<source>` is a file, or a standard module as `std:<name>`, such as `std:io`, which is then the program, read from those the compiler carries; an unknown one prints `unknown standard module 'std:<name>'` and exits with code 1. The same holds for the commands below. A file of `std/` given by its path is an ordinary module, which imports the carried `std:builtins` as any other does: `std/process.lerta` builds, while `std/builtins.lerta` fails, as its extends repeat those of the carried `std:builtins`.
- `<file>...`, after the source, are files that clang links with the program as it is given them: C (`.c`), LLVM IR (`.ll`), objects (`.o`, `.obj`) and archives (`.a`, `.lib`), such as those that define the C functions of the program's own [externs](functions.md#c-functions). With `-O`, clang compiles `.c` and `.ll` files with `-O2 -flto` as it does the program; objects and archives built without `-flto` link too.
- `-o <output>` names the executable. Without it, the executable is the source's name without `.lerta`, in the current directory, as `go build` names it: `lerta build examples/hello.lerta` writes `hello`, or `hello.exe` for a Windows target.
- Without `-O`, the program checks for leaked memory when it exits: a leak is reported to stderr as `leak: <n> object(s)`, and the exit code is 1.
- `-O` optimizes, including across the generated code and the runtime (link-time optimization).
- `--target <triple>` has clang build the executable for that target, such as `i686-linux-gnu` or `x86_64-w64-mingw32`; without it, the executable is for the host. A Windows target (`*-w64-mingw32`) needs mingw-w64, and lld, which links it.
- The build leaves no other file: it writes the LLVM IR and the runtime's C files to a temporary directory, which it removes after clang has built the executable from them, or failed to. A throw while the directory is there leaves it, as there is no `catch` yet: for a file that cannot be written, or for a program that cannot be started, clang or the one that `run` runs.

```
lerta run <source> [<file>...] [-O] [-- <arg>...]
```

is provisional, until it runs the program directly with JIT (see [the design](../design/programs.md#tools)). It builds the program as `build` does, from the same source and files, in the temporary directory, and runs it, in the current directory, with the arguments after `--`, which go to the program as they are, even those that look like options; the program shares the standard streams. It then removes the directory, unless a throw left it (see above), and exits with the program's exit code, or, if a signal ended it, 128 plus the signal number (see `run` in [std:process](modules.md#stdprocess)). `-o` and `--target` are usage errors, and so is an argument for the program without `--`. A compile error or a failure of clang is reported as by `build`, and nothing runs.

The commands below print what the lexer, the parser, the checker and codegen make of the source. They are there for debugging the compiler.

```
lerta dump-tokens <source>
```

prints the tokens of one file, without reading the modules it imports, one per line: `<line>:<column> <spaced|joined> <kind> "<text>"`, where `spaced` means that whitespace or the start of the line precedes it. An interpolated string is followed by its parts, indented: `text "<text>"` and `code <column> "<source>"`. In the quoted texts, the characters below U+0020, U+007F, `\` and `"` are written as `\xHH`. A lexical error is reported as a compile error.

```
lerta dump-ast <source>
```

prints the syntax tree of one file, likewise. A node is a line `<kind> <line>:<column>`, followed by its other fields, one per line and in the order of their names, indented under it: `<name>: <value>` for a value, written as in `dump-tokens` for a string and `-` for none, and `<name>:` followed by the contents on the next lines, indented further, for a node, a group of fields without a kind, or a list, whose items each follow a `-` line (or `- <value>` for a value). An empty list is `[]`. A group of fields without a kind that has a position writes it as its fields `line` and `column`. A syntax error is reported as a compile error.

```
lerta dump-checked <source>
```

loads and checks the program as `build` does, without generating code. For each module that is not a standard module, in the order they are loaded, it prints a line `module <path>`, with the path as given for the entry module and as diagnostics write it for the others, then the module's syntax tree as `dump-ast` prints it, as loaded, with the implicit import of `std:builtins`. The header line of each node that the checker gave a type is followed by ` : <type>`, and by ` => <type>` if the node is converted where it is used, such as an `Int` passed as an `Int?`; types are written as in messages. The bodies of generic functions, which are checked only for each use, have no types. Warnings and errors are reported as by `build`. The rest of what the checker works out (the captures of closures, the shared variables, the instances of generic functions and their checked bodies, the exports, the extensions and the objects) is not printed.

```
lerta dump-llvm <source>
```

prints the LLVM IR that `build` has clang compile, before optimization. It names no target, so it is the same for every one. Warnings and errors are reported as by `build`.

## Diagnostics

Diagnostics are printed to stderr, one per line:

```
<path>:<line>:<column>: <message>
<path>:<line>:<column>: warning: <message>
```

- A compile error stops the build, and the exit code is 1. Warnings found before it are printed first.
- A warning does not stop the build. Those of the standard modules are not reported, since the program cannot act on them; each standard module builds on its own without warnings.
- If `<source>` is not a file, `'<source>' is not a file` is printed, and the exit code is 1.
- If clang fails, its messages are printed as they are, and the exit code is 1.

Lines and columns start at 1, and columns count code points.
