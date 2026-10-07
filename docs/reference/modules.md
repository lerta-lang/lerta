# Modules

```
import { read_file, stdout } from 'std:io'
import { argv, exit } from 'std:process'
```

- A file is a module. `import { a, b } from 'module'` makes the named exports of a module available in the whole module, functions and methods included. `import { a as c } from 'module'` makes `a` available as `c`, so that two modules' exports of the same name can be imported together; one export may be imported under several names. `as` is not a keyword. Imports are written at the top level. An import that is never used is a warning.
- `'std:io'` and `'std:process'` are standard modules (below). A path that starts with `./` or `../` names another file, relative to the importing one, without the `.lerta` extension: `import { Point } from './lib/geometry'`. Other names are reserved.

## Exports

```
export struct Point
  x: Int
  y: Int

export type Shape = Point | Circle

export const origin = (): Point -> Point(x: 0, y: 0)
```

- `export` before a top-level function, class, struct or type alias makes it importable. Names are local to their module: other names cannot be imported, and different modules may use the same name. Classes and structs of the same name in different modules are different types; where a message would not tell them apart, it names their modules.
- Before the entry module's top-level code, that of every module it imports, directly or not, runs once, each after the modules it imports.
- So far:
  - only functions and types can be exported, not other values;
  - imports cannot be circular.

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
