# Modules

```
import { read_file, stdout } from 'std:io'
import { argv, exit } from 'std:process'
```

- `import { a, b } from 'module'` makes the named exports of a module available in the whole module, functions and methods included. Imports are written at the top level. An import that is never used is a warning.
- So far only the standard modules can be imported.

## std:io

| Name | |
|---|---|
| `read_file(path: String): Binary` | The contents of a file. Throws `cannot read file: <path>` on failure, including for a path that holds a NUL byte. |
| `write_file(path: String, data: Binary)` | Replaces the contents of a file, creating it if needed. Throws `cannot write file: <path>` on failure. |
| `stdout`, `stderr` | `Writer`s. `stdout` is buffered and flushed at exit; `stderr` is not buffered, and writing to it flushes `stdout` first, so that the two keep their order. |

A `Writer` has `write(s: String)`, `write_binary(b: Binary)` and `flush()`. `print` writes to `stdout` too.

## std:process

| Name | |
|---|---|
| `argv: Array<String>` | The command-line arguments, without the program name. Reading it throws if an argument is not valid UTF-8. |
| `exit(code: Int): never` | Flushes `stdout` and ends the program with the exit code, from 0 to 255; another code throws. If the flush fails, a code of 0 becomes 1. |
