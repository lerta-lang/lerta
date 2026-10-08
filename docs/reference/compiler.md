# Compiler

```
lerta build <source> -o <output> [-O] [--emit-llvm <path>]
```

builds an executable. In stage0, `lerta` is `node stage0/src/main.ts` (see the [README](../../README.md)). Arguments that do not fit this usage (an unknown or repeated option, a missing source or `-o`, or a value that starts with `-`) print the usage to stderr and exit with code 2.

- Without `-O`, the program checks for leaked memory when it exits: a leak is reported to stderr as `leak: <n> object(s)`, and the exit code is 1.
- `-O` optimizes, including across the generated code and the runtime (link-time optimization).
- `--emit-llvm <path>` also writes the generated LLVM IR, before optimization, to `<path>`.

```
lerta dump-tokens <source>
```

prints the tokens of one file, without reading the modules it imports, one per line: `<line>:<column> <spaced|joined> <kind> "<text>"`, where `spaced` means that whitespace or the start of the line precedes it. An interpolated string is followed by its parts, indented: `text "<text>"` and `code <column> "<source>"`. In the quoted texts, the characters below U+0020, U+007F, `\` and `"` are written as `\xHH`. It exists to compare the lexers of stage0 and of the compiler written in Lerta; a lexical error is reported as a compile error.

```
lerta dump-ast <source>
```

prints the syntax tree of one file, likewise, to compare the parsers. A node is a line `<kind> <line>:<column>`, followed by its other fields, one per line and in the order of their names, indented under it: `<name>: <value>` for a value, written as in `dump-tokens` for a string and `-` for none, and `<name>:` followed by the contents on the next lines, indented further, for a node, a group of fields without a kind, or a list, whose items each follow a `-` line (or `- <value>` for a value). An empty list is `[]`. A group of fields without a kind that has a position writes it as its fields `line` and `column`. A syntax error is reported as a compile error.

```
lerta dump-checked <source>
```

loads and checks the program as `build` does, without generating code, to compare the checkers. For each module that is not a standard module, in the order they are loaded, it prints a line `module <path>`, with the path as given for the entry module and as diagnostics write it for the others, then the module's syntax tree as `dump-ast` prints it, as loaded, with the implicit import of `std:builtins`. The header line of each node that the checker gave a type is followed by ` : <type>`, and by ` => <type>` if the node is converted where it is used, such as an `Int` passed as an `Int?`; types are written as in messages. The bodies of generic functions, which are checked only for each use, have no types. Warnings and errors are reported as by `build`. The rest of what the checker works out (the captures of closures, the shared variables, the instances of generic functions and their checked bodies, the exports, the extensions and the objects) is not printed; comparing the generated IR checks it.

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
