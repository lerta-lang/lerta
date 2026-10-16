# Modules

```
import read_file, stdout from 'std:io'
import argv, exit from 'std:process'
```

- A file is a module. `import a, b from 'module'` makes the named exports of a module available in the whole module, functions and methods included. `import a as c from 'module'` makes `a` available as `c`, so that two modules' exports of the same name can be imported together; one export may be imported under several names. A type or a value may be imported under the name of a builtin, which it then shadows, as a declaration does (see [control flow](control-flow.md)). `as` is not a keyword. The names are separated by commas, and the last one, which no comma follows, by `from`, so `from` itself can be imported. Imports are written at the top level. An imported name that is never used is a warning (see [unused names](errors.md#unused-names)).
- The names may also be an indented block on the lines below `import`, separated as the items of a [bracketless block](syntax.md#bracketless-blocks), with `from 'module'` on the line after it:
  ```
  import
    ArrayLiteral, Assignment, BinaryOperation, Call, Conditional, FunctionLiteral, Identifier,
    Await as wait
  from './ast'
  ```
- `import 'module'` imports no name, and so never warns: it only makes the module's top-level code run (see below), and brings its extends (see [objects](objects.md#extend)), as any import of it does.
- `'std:<name>'` is a standard module, the Lerta file `std/<name>.lerta` of the repository, which the compiler carries in it: `'std:io'`, `'std:process'` and `'std:time'` so far (below), and `'std:builtins'` (see [builtins](builtins.md)), which imports `std:io`; what `std:io` therefore cannot use is in [internals](../internals.md#builtins). A path that starts with `./` or `../` names another file, relative to the importing one, without the `.lerta` extension: `import Point from './lib/geometry'`. Other names are reserved.
- Why: ESM style, so there is no `import *` and no `export default` (see [philosophy](../philosophy.md#non-goals)). Paths need `./` or `../` and have no `index` resolution for directories. Functions can be declared in any order (see [top-level values](functions.md#top-level-values)).

## Exports

```
export struct Point
  x: Int
  y: Int

export struct Circle
  center: Point
  radius: Int

export type Shape = Point | Circle

export const origin = -> Point(x: 0, y: 0)
export const unit = 1
```

- `export` before a top-level `const` (a function or a value), class, struct, enum, interface or type alias makes it importable. An imported value cannot be assigned, and is narrowed as a `const` is (see [control flow](control-flow.md#if-and-while)). An exported value is not warned about if its module does not use it (see [unused names](errors.md#unused-names)). Names are local to their module: other names cannot be imported, and different modules may use the same name. Classes, structs and enums of the same name in different modules are different types; where a message would not tell them apart, it names their modules.
- A program runs the top-level code of its entry module from top to bottom; there is no `main`. Before it, that of every module it imports, directly or not, runs once, each after the modules it imports, except those that import it back; a module's top-level code that [awaits](functions.md#functions-that-await) is done only once it has stopped waiting. At the end of the program, the top-level values are released in the reverse order of their initialization, so that a `deinit` that runs then can still use those initialized before. Each is uninitialized again as it is released, so reading one already released, own or imported, throws an `InitError` (see [top-level values](functions.md#top-level-values)).
- Imports can be circular. The top-level code of a cycle of modules runs as that of one module would: that of its members one after another, in the order above, so in a cycle that the entry module enters at `a`, where `a` imports `b` and `b` imports `a`, `b` runs first. Within the cycle, the rules of one module's top-level values carry over (see [top-level values](functions.md#top-level-values)): functions can be used in any order, an inferred type is worked out where it is needed, and a value read through a function before it is initialized throws. The top-level code of a module cannot read a value of a module of its cycle that runs after it, nor call a function whose return type is inferred, or construct an object whose field type is inferred, that does: the value's type is not known yet. Functions whose return types are inferred cannot call each other across modules either (`'f' is recursive, so its return type must be written`). Type aliases cannot refer to each other in a cycle across modules, as within one. A cycle does not widen where an extend is in effect (see [objects](objects.md#extend)).

## std:io

| Name | |
|---|---|
| `read_file(path: String): Binary` | The contents of a file. Throws `cannot read file: <path>` on failure, including for a path that holds a NUL byte. |
| `write_file(path: String, data: Binary)` | Replaces the contents of a file, creating it if needed. Throws `cannot write file: <path>` on failure. |
| `is_file(path: String): Bool` | Whether the path names a regular file (through symbolic links); false for a directory, a missing file or a path that holds a NUL byte. |
| `is_dir(path: String): Bool` | Whether the path names a directory (through symbolic links); false for a file, a missing path or a path that holds a NUL byte. |
| `list_dir(path: String): String[]` | The names of the entries of a directory, without `.` and `..`, in the order of their bytes. Throws `cannot list directory: <path>` if the path does not name a directory that can be read, is empty or holds a NUL byte, and a `ValueError`, `a name is not valid UTF-8 in the directory: <path>`, if a name is not valid UTF-8. On Windows, whose names are UTF-16, a name that is not valid UTF-16 is read with U+FFFD in place of what is not, as the other paths that Windows gives are. |
| `real_path(path: String): Binary` | The absolute path of what the path names, without `.`, `..` or symbolic links. It is a `Binary`, as nothing makes it UTF-8. Throws `cannot resolve path: <path>` if it names nothing, or holds a NUL byte. |
| `make_temp_dir(): Binary` | Makes a new, empty directory in the system's directory for temporary files (`TMPDIR`, or else `/tmp`, on POSIX systems; `GetTempPathW` on Windows), and returns its path, as a `Binary`, as `real_path` does. Throws `cannot make a temporary directory` on failure. |
| `remove_tree(path: String)` | Removes a file, or a directory with everything in it. A symbolic link is removed, not what it links to. Throws `cannot remove: <path>` on failure, including for a path that names nothing or holds a NUL byte. On POSIX systems, each level of nesting holds a directory open, so a tree deeper than the limit on open files fails; on Windows, a read-only file is not removed, which fails. |
| `make_dir(path: String)` | Makes a directory and any of its parents that are missing; a directory that is there already is no failure. Throws `cannot make directory: <path>` on failure, including for an empty path or one that holds a NUL byte. |
| `rename(from: String, to: String)` | Moves a file or a directory, replacing a file at `to`; on POSIX systems, the replacement is atomic. A directory also replaces an empty directory at `to` on POSIX systems, but not on Windows. Throws `cannot rename: <from>` on failure, including when `to` is a directory that is not empty, or a path holds a NUL byte. |
| `stdout`, `stderr` | `Writer`s. `stderr` is not buffered, and neither is `stdout` when it is a terminal. Otherwise `stdout` is buffered, and flushed at exit and before each write to `stderr`, so that the two keep their order. Once a write to `stdout` fails, its later output is dropped, and the program exits with code 1 if it would exit with 0. A write to a pipe whose reader has closed it, as in `program \| head -1`, ends the program on POSIX systems by the signal SIGPIPE, which shells report as status 141, as it does C programs, even if the program was started with SIGPIPE ignored, so that a program that writes on and on stops with its reader; on Windows, which has no such signal, the write fails as any other. |

`Writer`, exported too, is a struct of a file descriptor with the methods `write(s: String)`, `write_binary(b: Binary)` and `flush()`; a `Writer` of a file descriptor other than 1 (stdout) or 2 (stderr) throws when it is used.

## std:process

| Name | |
|---|---|
| `argv: String[]` | The command-line arguments, without the program name, read when the module runs. A program that imports `std:process` throws at its start if an argument is not valid UTF-8. |
| `exit(code: Int): never` | Flushes `stdout` and ends the program with the exit code, from 0 to 255; another code throws a `ValueError`. If the flush fails, a code of 0 becomes 1. |
| `run(command: String, args: String[], stdout: Byte[]? = nil): Promise<Int>` | Runs a program, found on `PATH` on every platform unless the command holds a directory (on Windows, `<command>.exe` before `<command>` on `PATH`, and with a directory, the name as it is before it with `.com` and then `.exe` added), with the arguments, in the [event loop](functions.md#functions-that-await): programs run at the same time. The program shares the standard streams, but for its standard output when `stdout` is given, which it is appended to; `stdout` is flushed first, so that output keeps its order. The `Promise` is resolved with its exit code once it ends. On POSIX systems, a program killed by a signal gives 128 plus the signal number, as shells do; on Windows, the code of a program that an exception or `TerminateProcess` ended is returned as a non-negative 32-bit value, such as 3221225477 (0xC0000005) for an access violation; this case is not tested yet. The `Promise` is rejected with `cannot run: <command>` if the program cannot start, including when the command or an argument holds a NUL byte, and with `cannot read the output of: <command>` if its output cannot be read. |
| `env(name: String): String?` | The value of an environment variable, or nil if it is not set, including for a name that holds `=` or a NUL byte. Throws a `ValueError`, `the environment variable <name> is not valid UTF-8`, if the value is not. |
| `platform: String` | The system the program runs on: `'linux'`, `'macos'` or `'windows'`. |
| `cpu_count: Int` | The number of CPUs that are online when the module runs, at least 1. |
| `process_id: Int` | The ID of the program's process. |
| `is_running(id: Int): Bool` | Whether a process with the ID is running, including one that the program may not signal. An ID of 0 or below, or beyond those the system gives, is not. |

## std:time

| Name | |
|---|---|
| `sleep(seconds: Float): Promise` | A promise that is resolved once at least the seconds have passed (a time of zero only lets other work run first), for a [function that awaits](functions.md#functions-that-await) to wait for. Throws a `ValueError`, `sleep for a negative time`, for a negative time. |
| `time(): Float` | The seconds since the Unix epoch, 1970-01-01T00:00:00Z, with their fraction, as the system's clock tells them; it may go back if the clock is set back. |
