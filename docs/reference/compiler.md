# Compiler

```
lerta build <source> -o <output>
```

builds an executable. A compile error is printed to stderr as

```
<path>:<line>:<column>: <message>
```

and the exit code is 1. Lines and columns start at 1, and columns count code points.
