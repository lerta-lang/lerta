# Compiler

```
lerta build <source> -o <output> [-O] [--emit-llvm <path>]
```

builds an executable. In stage0, `lerta` is `node stage0/src/main.ts` (see the [README](../../README.md)). Arguments that do not fit this usage (an unknown or repeated option, a missing source or `-o`, or a value that starts with `-`) print the usage to stderr and exit with code 2.

- Without `-O`, the program checks for leaked memory when it exits: a leak is reported to stderr as `leak: <n> object(s)`, and the exit code is 1.
- `-O` optimizes, including across the generated code and the runtime (link-time optimization).
- `--emit-llvm <path>` also writes the generated LLVM IR, before optimization, to `<path>`.

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
