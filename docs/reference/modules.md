# Modules

```
import { read_file, stdout } from 'std:io'
import { argv, exit } from 'std:process'
```

- A file is a module. `import { a, b } from 'module'` makes the named exports of a module available in the whole module, functions and methods included. `import { a as c } from 'module'` makes `a` available as `c`, so that two modules' exports of the same name can be imported together; one export may be imported under several names. `as` is not a keyword. Imports are written at the top level. An imported name that is never used is a warning.
- `import 'module'` imports no name, and so never warns: it only makes the module's top-level code run (see below), and brings its extends (see [objects](objects.md#extend)), as any import of it does.
- `'std:<name>'` is a standard module, the Lerta file `std/<name>.lerta` of the repository: `'std:io'` and `'std:process'` so far (below), and `'std:builtins'`, which every other module imports implicitly (see [builtins](builtins.md)). A path that starts with `./` or `../` names another file, relative to the importing one, without the `.lerta` extension: `import { Point } from './lib/geometry'`. Other names are reserved.

## Exports

```
export struct Point
  x: Int
  y: Int

export type Shape = Point | Circle

export const origin = (): Point -> Point(x: 0, y: 0)
export const unit = 1
```

- `export` before a top-level `const` (a function or a value), class, struct or type alias makes it importable. An imported value cannot be assigned, and is narrowed as a `const` is (see [control flow](control-flow.md#if-and-while)). An exported value is not warned about if its module does not use it. Names are local to their module: other names cannot be imported, and different modules may use the same name. Classes and structs of the same name in different modules are different types; where a message would not tell them apart, it names their modules.
- Before the entry module's top-level code, that of every module it imports, directly or not, runs once, each after the modules it imports.
- So far, imports cannot be circular.

## std:io

| Name | |
|---|---|
| `read_file(path: String): Binary` | The contents of a file. Throws `cannot read file: <path>` on failure, including for a path that holds a NUL byte. |
| `write_file(path: String, data: Binary)` | Replaces the contents of a file, creating it if needed. Throws `cannot write file: <path>` on failure. |
| `stdout`, `stderr` | `Writer`s. `stdout` is buffered and flushed at exit; `stderr` is not buffered, and writing to it flushes `stdout` first, so that the two keep their order. |

`Writer`, exported too, is a struct of a file descriptor with the methods `write(s: String)`, `write_binary(b: Binary)` and `flush()`; a `Writer` of a file descriptor other than 1 (stdout) or 2 (stderr) throws when it is used. `print` writes to `stdout` too.

## std:process

| Name | |
|---|---|
| `argv: Array<String>` | The command-line arguments, without the program name, read when the module runs. A program that imports `std:process` throws at its start if an argument is not valid UTF-8. |
| `exit(code: Int): never` | Flushes `stdout` and ends the program with the exit code, from 0 to 255; another code throws. If the flush fails, a code of 0 becomes 1. |
