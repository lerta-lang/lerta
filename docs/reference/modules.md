# Modules

```
import { read_file, stdout } from 'std:io'
import { argv, exit } from 'std:process'
```

- A file is a module. `import { a, b } from 'module'` makes the named exports of a module available in the whole module, functions and methods included. `import { a as c } from 'module'` makes `a` available as `c`, so that two modules' exports of the same name can be imported together; one export may be imported under several names. `as` is not a keyword. Imports are written at the top level. An imported name that is never used is a warning.
- `import 'module'` imports no name, and so never warns: it only makes the module's top-level code run (see below), and brings its extends (see [objects](objects.md#extend)), as any import of it does.
- `'std:<name>'` is a standard module, the Lerta file `std/<name>.lerta` of the repository, which the compiler carries in it: `'std:io'` and `'std:process'` so far (below), and `'std:builtins'` (see [builtins](builtins.md)); `std:io`, which `std:builtins` imports, cannot use the builtins. A path that starts with `./` or `../` names another file, relative to the importing one, without the `.lerta` extension: `import { Point } from './lib/geometry'`. Other names are reserved.

## Exports

```
export struct Point
  x: Int
  y: Int

export type Shape = Point | Circle

export const origin = (): Point -> Point(x: 0, y: 0)
export const unit = 1
```

- `export` before a top-level `const` (a function or a value), class, struct, enum or type alias makes it importable. An imported value cannot be assigned, and is narrowed as a `const` is (see [control flow](control-flow.md#if-and-while)). An exported value is not warned about if its module does not use it. Names are local to their module: other names cannot be imported, and different modules may use the same name. Classes, structs and enums of the same name in different modules are different types; where a message would not tell them apart, it names their modules.
- A program runs the top-level code of its entry module from top to bottom; there is no `main`. Before it, that of every module it imports, directly or not, runs once, each after the modules it imports, except those that import it back.
- Imports can be circular. The top-level code of a cycle of modules runs as that of one module would: that of its members one after another, in the order above, so in a cycle that the entry module enters at `a`, where `a` imports `b` and `b` imports `a`, `b` runs first. Within the cycle, the rules of one module's top-level values carry over (see [functions](functions.md)): functions can be used in any order, an inferred type is worked out where it is needed, and a value read through a function before it is initialized throws. The top-level code of a module cannot read a value of a module of its cycle that runs after it, nor call a function whose return type is inferred, or construct an object whose field type is inferred, that does: the value's type is not known yet. Functions whose return types are inferred cannot call each other across modules either (`'f' is recursive, so its return type must be written`). Type aliases cannot refer to each other in a cycle across modules, as within one. An extend is still in effect only in its module and those that import it directly.

## std:io

| Name | |
|---|---|
| `read_file(path: String): Binary` | The contents of a file. Throws `cannot read file: <path>` on failure, including for a path that holds a NUL byte. |
| `write_file(path: String, data: Binary)` | Replaces the contents of a file, creating it if needed. Throws `cannot write file: <path>` on failure. |
| `is_file(path: String): Bool` | Whether the path names a regular file (through symbolic links); false for a directory, a missing file or a path that holds a NUL byte. |
| `real_path(path: String): Binary` | The absolute path of what the path names, without `.`, `..` or symbolic links. It is a `Binary`, as nothing makes it UTF-8. Throws `cannot resolve path: <path>` if it names nothing, or holds a NUL byte. |
| `make_temp_dir(): Binary` | Makes a new, empty directory in the system's directory for temporary files (`TMPDIR`, or else `/tmp`, on POSIX systems; `GetTempPathW` on Windows), and returns its path, as a `Binary`, as `real_path` does. Throws `cannot make a temporary directory` on failure. |
| `remove_tree(path: String)` | Removes a file, or a directory with everything in it. A symbolic link is removed, not what it links to. Throws `cannot remove: <path>` on failure, including for a path that names nothing or holds a NUL byte. |
| `stdout`, `stderr` | `Writer`s. `stderr` is not buffered, and neither is `stdout` when it is a terminal. Otherwise `stdout` is buffered, and flushed at exit and before each write to `stderr`, so that the two keep their order. |

`Writer`, exported too, is a struct of a file descriptor with the methods `write(s: String)`, `write_binary(b: Binary)` and `flush()`; a `Writer` of a file descriptor other than 1 (stdout) or 2 (stderr) throws when it is used. `print` writes to `stdout` too.

## std:process

| Name | |
|---|---|
| `argv: Array<String>` | The command-line arguments, without the program name, read when the module runs. A program that imports `std:process` throws at its start if an argument is not valid UTF-8. |
| `exit(code: Int): never` | Flushes `stdout` and ends the program with the exit code, from 0 to 255; another code throws. If the flush fails, a code of 0 becomes 1. |
| `run(command: String, args: Array<String>): Int` | Runs a program, found on `PATH` on every platform (adding `.exe` on Windows if it has no extension) unless the command holds a directory, with the arguments, and waits for it to end. The program shares the standard streams; `stdout` is flushed first, so that output keeps its order. Returns its exit code. On POSIX systems, a program killed by a signal gives 128 plus the signal number, as shells do; on Windows, the code of a program that an exception or `TerminateProcess` ended is returned as a non-negative 32-bit value, such as 3221225477 (0xC0000005) for an access violation; this case is not tested yet. Throws `cannot run: <command>` if it cannot start, including when the command or an argument holds a NUL byte. |
