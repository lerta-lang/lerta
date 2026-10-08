# Compiler

```
lerta build <source> -o <output> [-O] [--emit-llvm <path>]
```

builds an executable.

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

Lines and columns start at 1, and columns count code points.
