# Compiler

```
lerta build <source> -o <output>
```

builds an executable. Diagnostics are printed to stderr, one per line:

```
<path>:<line>:<column>: <message>
<path>:<line>:<column>: warning: <message>
```

- A compile error stops the build, and the exit code is 1. Warnings found before it are printed first.
- A warning does not stop the build.

Lines and columns start at 1, and columns count code points.
