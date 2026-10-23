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
- `import 'module' as mod` gives its exports as `mod.<export>`, in values (`mod.distance(p, q)`, `mod.ORIGIN`, `mod.Point(x: 1, y: 2)`, `mod.Color.RED`) and in types (`p: mod.Point`, `<T: mod.Shaped>`), alongside any names imported from it by name. `mod` itself is no value (`'mod' is a module, which is no value: write mod.<export>`), and a local of the name hides it in values, as it hides any other name, though not in types, whose names are apart from those of values. An export the module does not have is an error where `mod.<export>` names it, and an unused `mod` warns as an unused name does. This is not the `import *` that [philosophy](../philosophy.md#non-goals) leaves out, which would bring the names in unqualified.
- `'std:<name>'` is a standard module, the Lerta file `std/<name>.lerta` of the repository, which the compiler carries in it: `'std:async'`, `'std:io'`, `'std:json'`, `'std:math'`, `'std:process'`, `'std:scanner'` and `'std:time'` so far (below), and `'std:builtins'` (see [builtins](builtins.md)). A standard module may import the files of `std/`'s directories, as `std/internal/`, by relative paths, `import JsonWriter from './internal/json_writer'`, as a file imports another; those files are not standard modules: a program cannot import them as `std:...`, and their warnings show only when a standard module that imports them is built on its own. A path that starts with `./` or `../` names another file, relative to the importing one, without the `.lerta` extension: `import Point from './lib/geometry'`. Other names are reserved.
- Why: ESM style, so there is no `import *` and no `export default` (see [philosophy](../philosophy.md#non-goals)). Paths need `./` or `../` and have no `index` resolution for directories. Functions can be declared in any order (see [top-level values](functions.md#top-level-values)).

## Exports

```
export struct Point(x: Int, y: Int)

export struct Circle(center: Point, radius: Int)

export type Shape = Point | Circle

export origin := -> Point(x: 0, y: 0)
export unit := 1
```

- `export` before a top-level `const` (a function or a value), class, struct, enum, interface or type alias makes it importable. An imported value cannot be assigned, and is narrowed as a `const` is (see [control flow](control-flow.md#if-and-while)). An exported value is not warned about if its module does not use it (see [unused names](errors.md#unused-names)). Names are local to their module: other names cannot be imported, and different modules may use the same name. Classes, structs and enums of the same name in different modules are different types; where a message would not tell them apart, it names their modules.
- `export a, b as c from 'module'` exports names of another module as this module's own, under their aliases if they have them, in a line or in an indented block as an import's names; the importers get the declarations themselves, so that a type is the same through either module. The names are not imported into this module, which imports them apart if it uses them. A name the module does not export is an error, as are a name exported twice and modules that export a name from each other. `export 'module'` exports no name. Both bring the module's extends, as an import does, and pass them on: an extend is also in effect in the modules that import one that exports from its module, by any export, and so on through modules that export from those. `export` of names or of a module is at the top level, and takes no `as name` of the module.
- A program runs the top-level code of its entry module from top to bottom; there is no `main`. Before it, that of every module it imports, directly or not, runs once, each after the modules it imports, except those that import it back; a module's top-level code that [awaits](functions.md#functions-that-await) is done only once it has stopped waiting. At the end of the program, the top-level values are released in the reverse order of their initialization, so that a `deinit` that runs then can still use those initialized before. Each is uninitialized again as it is released, so reading one already released, own or imported, throws an `InitError` (see [top-level values](functions.md#top-level-values)).
- Imports can be circular. The top-level code of a cycle of modules runs as that of one module would: that of its members one after another, in the order above, so in a cycle that the entry module enters at `a`, where `a` imports `b` and `b` imports `a`, `b` runs first. Within the cycle, the rules of one module's top-level values carry over (see [top-level values](functions.md#top-level-values)): functions can be used in any order, an inferred type is worked out where it is needed, and a value read through a function before it is initialized throws. The top-level code of a module cannot read a value of a module of its cycle that runs after it, nor call a function whose return type is inferred, or construct an object whose field type is inferred, that does: the value's type is not known yet. Functions whose return types are inferred cannot call each other across modules either (`'f' is recursive, so its return type must be written`). Type aliases cannot refer to each other in a cycle across modules, as within one. A cycle does not widen where an extend is in effect (see [objects](objects.md#extend)).

## std:async

| Name | |
|---|---|
| `Deferred<T>` | A class of a promise and what settles it, apart: its method `promise(): Promise<T>` gives a promise that waits until its method `resolve(value: T)` or `reject(error: Error)` is called. The first of them settles it, and later ones change nothing. `promise()` gives the same promise each time; it is made when it is first asked for, so a Deferred that is never settled, or whose promise is never asked for, leaves nothing waiting. A promise rejected and dropped with nothing to await it ends the program, as any promise's does; one that is never settled keeps what awaits it waiting, which the debug runtime reports as a leak at exit, as it does for any function that awaits a promise that is never settled (see [internals](../internals.md#functions-that-await)). |
| `all(promises)` | For `Promise<T>[]`, a `Promise<T[]>` of the value of each promise, in their order, once all are resolved; for `Promise[]`, of promises without a value, a `Promise` without one, resolved once all are. The error of the first promise that is rejected rejects it at once. |
| `race(promises)` | For `Promise<T>[]`, a `Promise<T>` of the value or the error of the first of the promises to be settled; for `Promise[]`, a `Promise` without a value. The others are then cancelled. Of no promises, it is never settled. |
| `timeout(promise, seconds)` | For a `Promise<T>`, a `Promise<T>` of its value or its error if it is settled within the seconds; for a `Promise`, a `Promise` without a value. Otherwise, the promise is cancelled and a `TimeoutError` rejects it, `timed out after <seconds> seconds`, as the error of `sleep` does for seconds below 0. |
| `TimeoutError` | The error of `timeout`, a struct of one field, `message`. |

`all`, `race` and `timeout` await each of the promises, so that the error of one that is rejected after the outcome is decided ends nothing. Cancelled, they cancel the promises they were given (see [functions that await](functions.md#functions-that-await)); an error that rejects `all` leaves the others going on. Promises with a value and without one are not mixed, as an array holds items of one type, and `all` of promises of an optional `Int`, `Byte`, `Float` or `Bool` is an error, as no array holds them (see [arrays](types.md#array)). `all`, `race` and `timeout` are generic functions that call the methods `gathered`, `first_settled` and `settled_within` of an extend of `Promise<T>[]` and one of `Promise[]`, which are in effect where `std:async` is imported (see [objects](objects.md#extend)), so those names are taken there; `timeout` passes its promise in an array of one, as a `Promise` cannot be extended.

## std:io

| Name | |
|---|---|
| `read_file(path: String): Promise<Binary>` | The contents of a file, read on the event loop. Rejected with `cannot read file: <path>` on failure, including for a path that holds a NUL byte. |
| `write_file(path: String, data: Binary): Promise` | Replaces the contents of a file, creating it if needed, on the event loop. Rejected with `cannot write file: <path>` on failure. |
| `is_file(path: String): Bool` | Whether the path names a regular file (through symbolic links); false for a directory, a missing file or a path that holds a NUL byte. |
| `is_dir(path: String): Bool` | Whether the path names a directory (through symbolic links); false for a file, a missing path or a path that holds a NUL byte. |
| `list_dir(path: String): String[]` | The names of the entries of a directory, without `.` and `..`, in the order of their bytes. Throws `cannot list directory: <path>` if the path does not name a directory that can be read, is empty or holds a NUL byte, and a `ValueError`, `a name is not valid UTF-8 in the directory: <path>`, if a name is not valid UTF-8. On Windows, whose names are UTF-16, a name that is not valid UTF-16 is read with U+FFFD in place of what is not, as the other paths that Windows gives are. |
| `real_path(path: String): Binary` | The absolute path of what the path names, without `.`, `..` or symbolic links. It is a `Binary`, as nothing makes it UTF-8. Throws `cannot resolve path: <path>` if it names nothing, or holds a NUL byte. On POSIX systems, the system works a path out as it reads it, so a `..` names the directory above the one a symbolic link before it points into, and a path through a name that is not there names nothing; on Windows, it works `.` and `..` out as text first, so a `..` cancels the name before it, a link or not, there or not. |
| `make_temp_dir(): Binary` | Makes a new, empty directory in the system's directory for temporary files (on POSIX systems, the first of `TMPDIR`, `TMP`, `TEMP` and `TEMPDIR` that is set, or else `/tmp`, also if that is set empty; `GetTempPathW` on Windows), and returns its path, as a `Binary`, as `real_path` does. Throws `cannot make a temporary directory` on failure. |
| `remove_tree(path: String): Promise` | Removes a file, or a directory with everything in it, on the event loop. A symbolic link is removed, not what it links to. Rejected with `cannot remove: <path>` on failure, including for a path that names nothing or holds a NUL byte. On Windows, a read-only file is removed too. |
| `make_dir(path: String)` | Makes a directory and any of its parents that are missing; a directory that is there already is no failure. Throws `cannot make directory: <path>` on failure, including for an empty path or one that holds a NUL byte. |
| `rename(from: String, to: String)` | Moves a file or a directory, replacing a file at `to`; on POSIX systems, the replacement is atomic. A directory also replaces an empty directory at `to` on POSIX systems, but not on Windows. Throws `cannot rename: <from>` on failure, including when `to` is a directory that is not empty, or a path holds a NUL byte. |
| `stat(path: String): FileStatus?` | What the path names, through symbolic links, or nil if nothing is there, as for a dangling link or a path that holds a NUL byte. Throws `cannot read the status of: <path>` if it cannot be read, as for a loop of links. |
| `FileStatus` | A struct of `kind: FileKind`; `size: Int`, in bytes; and `modified_time: Float`, when it was last modified, in seconds since the Unix epoch, as `time` of [std:time](#stdtime) tells them. |
| `FileKind` | An enum of `FILE`, `DIR` and `OTHER`, as a device. |
| `make_link(target: String, path: String)` | Makes a symbolic link at `path` to `target`, which is written as it is, relative to the link's directory unless it is absolute, and need not be there. On Windows, `/` in either is written `\`, and the link is to a directory if the target is one when it is made; making it needs developer mode or the privilege to make links. On Windows, this is tested under Wine alone, which makes such links but does not follow them, so that following them is not tested yet. Throws `cannot make link: <path>` on failure, as when something is at `path`. |
| `copy_file(from: String, to: String): Promise` | Copies the contents of a file, replacing a file at `to`, on the event loop; on POSIX systems, the copy takes the permissions of the file. Rejected with `cannot copy file: <from>` on failure, including for a path that holds a NUL byte, for a directory, and for a copy onto the file itself, which is left as it was. |
| `stdout`, `stderr` | `Writer`s, which write through one buffer for both, to a terminal or not, in the order of the writes, so that the output keeps its order where the two go to the same place. The buffer is written out on the event loop when it holds 64 KiB or more, on `flush`, before each `print` and `print_error` (see [builtins](builtins.md)), before `run` starts a program, and at exit. Once a write to `stdout` or `stderr` fails, its later output is dropped, and once one to `stdout` fails, the program exits with code 1 if it would exit with 0. A write to a pipe whose reader has closed it, as in `program \| head -1`, ends the program on POSIX systems by the signal SIGPIPE, which shells report as status 141, as it does C programs, even if the program was started with SIGPIPE ignored, so that a program that writes on and on stops with its reader; on Windows, which has no such signal, the write fails as any other. |
| `stdin` | A `Reader` of the standard input, which reads it on the event loop in chunks of up to 64 KiB, through a buffer that its methods share. A closed stdin reads as empty. A read that fails is rejected with an `IOError`, `cannot read stdin`. |

`read_file`, `write_file`, `remove_tree` and `copy_file` run at the same time as each other and as the program, so one that depends on another, as a read of a file that a write makes, awaits it first.

`Reader`, exported too, is a class that reads a stream in chunks through a buffer: its field `read_chunk: () -> Promise<Binary?>` gives the next chunk, or nil at the end. Its methods are `read_line(): Promise<String?>`, the next line without its `\n` and a `\r` before it, or nil at the end, which throws a `ValueError`, `a line is not valid UTF-8`, for one that is not; `read(count: Int): Promise<Binary?>`, `count` bytes, or as many as are left if the end comes first, or nil at the end, which throws a `ValueError` for a count below 1; and `read_all(): Promise<Binary>`, all that is left. A read must end before the next one starts: one that starts while another is pending throws a `ValueError`, `a Reader is read by another read that has not ended`. A read that throws or is cancelled leaves what it has taken from the chunks for the next, and a cancel cancels the chunk it waits for, if it waits for one (see [functions that await](functions.md#functions-that-await)); a chunk that `read_chunk` has given but the read has not taken yet is lost, unless `read_chunk` keeps it for the next call itself, as that of `stdin` does. A read of `stdin` keeps the program running until it ends, as a timer does, even if nothing awaits it.

`Writer`, exported too, is a struct of a file descriptor with the methods `write(s: String): Promise`, `write_binary(b: Binary): Promise` and `flush(): Promise`; a `Writer` of a file descriptor other than 1 (stdout) or 2 (stderr) throws when it is used. A write that leaves the buffer under 64 KiB is resolved at once; one that fills it is resolved once its bytes are written out, so that a program that writes faster than its reader reads waits for it, and `flush` once all that was written before it is. Once the bytes of a stream fail to be written out, the writes and flushes that wait for them, and every later write and flush of the stream, are rejected with an `IOError`, `cannot write to stdout` or `cannot write to stderr`; a write resolved at once is not.

## std:json

```
import decode_json, encode_json from 'std:json'

text := encode_json([1, 2])  # '[1,2]'
xs := decode_json<Int[]>(text)
```

| Name | |
|---|---|
| `encode_json<T: Jsonable>(value: T, keys: JsonKeys = JsonKeys.AS_WRITTEN): String` | The value as JSON, with no whitespace. |
| `decode_json<T: Jsonable>(text: String, keys: JsonKeys = JsonKeys.AS_WRITTEN): T` | The value of type `T` that the text holds, with whitespace around its parts and nothing but whitespace after it. Throws a `JsonError` for text that is not JSON or does not fit `T`. |
| `Jsonable` | The interface of the types that the two convert, which only bounds type parameters, as `<T: Jsonable>` of a function that passes its type on to them: a type of values would not tell which type to convert by. It has no members: the compiler tells the types that satisfy it by their parts, and generates the code that converts each, so no type declares anything for it. It is the only interface without members. |
| `JsonKeys` | How the keys of the fields of objects are written: `AS_WRITTEN`, as the fields' names, or `CAMEL_CASE`, with each `_` between another character and a lowercase ASCII letter left out and the letter in uppercase, as `textDocument` for `text_document`, for formats such as the LSP's; a leading `_`, one after another, and one before anything else, stay. The keys of maps, which are data, stay as they are. A type with two fields that camel case writes as one key, as `ab_c` and `abC`, does not satisfy `Jsonable`. |
| `JsonError` | The error of `decode_json`, and of `encode_json` for a value that holds itself (below), a struct of a `message`. |

The types convert as the table says, and a type that has a part of another type, such as a function, a `Promise`, an `Iter`, an interface, or a `weak` field, does not satisfy `Jsonable`, which is an error at the call that names its path, as JsonError's messages write it, with `$[]` for an item of an array and `$.*` for a value of a map: `Request does not satisfy Jsonable: $.handler is of type (Int) -> Int, which std:json does not convert`.

| Lerta | JSON |
|---|---|
| `Int` and the other integer types | a number written as an integer, without a fraction or an exponent, in the range of the type: `$.size: expected a Byte, found 256` |
| `Float`, `Float32` | a number, written as the type's `to_string` writes it; one that is not finite as one of the type, as `1e400`, is none |
| `Bool` | `true` or `false` |
| `String` | a string; `encode_json` escapes `"`, `\` and the control characters, and `decode_json` reads every escape of JSON, a surrogate pair as one code point, but no lone surrogate |
| `Binary` | a string of its bytes in base64 (RFC 4648), with its `=` padding; `decode_json` takes only that, with the bits that the padding leaves over zero, so that each `Binary` has one text |
| `T?` | `null` for nil, otherwise as `T` |
| `T[]` | an array |
| tuples | an array of as many items |
| `Map<String, V>` | an object, of the entries in their order |
| classes, structs, anonymous structs | an object, of a key for each field, as `JsonKeys` writes its name, in the order of the fields. `decode_json` reads the fields that the constructor takes, and constructs the object as a call does, running its `init`: a field with a default, or of an optional type, may be left out, and is then its default, or nil; a key that is no such field, as one of a field given by an initializer alone, is skipped. A key may not be given twice. |
| enums | the member's name, as a string |
| unions | the member, as it is written alone. `decode_json` takes the member that the kind of the JSON value tells: a number, `true` or `false`, a string or an object. So the members must be of different kinds: a union of two number types, as `Int` and `Float`, of two that are strings, as `String` and `Binary` or an enum, or of two classes or structs, does not satisfy `Jsonable`. A value of no member's kind is an error, `$.id: expected Int \| String, found an array`. |

The message of a `JsonError` gives the path to the value it is about, `$` for the whole value, `[i]` for an item of an array and `.name` for the value of a key, and what was expected and found: `$.items[1]: expected an Int, found 2.5`; for an object, `$.position: missing the key "line"`, `$.kind: the key "kind" twice`, and `$.color: expected a member of Color, found "BLUE"` for an enum. What is found is a number as it is written, `null`, `true`, `false`, `a string`, `an array`, `an object`, `a number that is not JSON`, a character in quotes, or `the end of the text`. A string that does not end, an escape that is not JSON, a lone surrogate and a control character in a string give messages of their own.

`encode_json` throws a `JsonError` for a value that holds itself, through any of its parts, naming the path to where it does and the path it comes back to: `$.children[0].parent: a cycle back to $`. An object reached twice otherwise is written twice. Only the classes and structs whose types can hold themselves are looked for.

## std:math

Functions of `Float`s, which throw an `ArithmeticError` where the result would not be finite, as `Float`'s operators do (see [Float](types.md#float)). `min` and `max` are [builtins](builtins.md).

| Name | |
|---|---|
| `abs(x: Float): Float` | The value without its sign. |
| `floor(x: Float): Float`, `ceil(x: Float): Float` | The greatest integer not above `x`, and the least not below it, as `Float`s; `.to_int()` makes an `Int?` of one, nil beyond an `Int`. |
| `round(x: Float): Float` | The nearest integer, half way between two away from zero: `round(2.5)` is `3.0`, `round(-2.5)` is `-3.0`. |
| `sqrt(x: Float): Float` | The square root. Throws `square root of a negative number` for one below 0. |
| `pow(x: Float, y: Float): Float` | `x` to the power `y`. Throws `float overflow` where the result is too large, `division by zero` for 0 to a negative power, and `a negative number to a fractional power` for a negative `x` and a `y` that is no integer. |
| `remainder(x: Float, y: Float): Float` | The remainder of `x` divided by `y`, `x - n * y` for `n` the integer of `x / y` truncated toward zero, as `%` of `Int`s takes it, so of the sign of `x`: `remainder(-7.5, 2.0)` is `-1.5`. It is C's `fmod`, not its `remainder`, which rounds `n` to the nearest. Throws `division by zero` for a `y` of 0. |

## std:process

| Name | |
|---|---|
| `argv: String[]` | The command-line arguments, without the program name, read when the module runs. A program that imports `std:process` throws at its start if an argument is not valid UTF-8. |
| `exit(code: Int): never` | Writes out the buffer of `stdout` and `stderr` and ends the program with the exit code, from 0 to 255; another code throws a `ValueError`. If a write to `stdout` has failed, a code of 0 becomes 1. |
| `run(command: String, args: String..., options: RunOptions): Promise<Exit>` | Runs a program, found on `PATH` on every platform unless the command holds a directory (on Windows, `<command>.exe` before `<command>` on `PATH`, and with a directory, the name as it is before it with `.com` and then `.exe` added; on POSIX systems, the `PATH` that the program is given, as `env` may change it, and on Windows, this program's), with the arguments, in the [event loop](functions.md#functions-that-await): programs run at the same time. The options, given as named arguments (see [functions](functions.md)), are below. `stdout` is flushed first, so that output keeps its order. The `Promise` is resolved with how the program ended, an `Exit`, once it ends. A cancel stops the program: on POSIX systems, it is sent SIGTERM, then SIGKILL if it has not ended after `kill_after` seconds; on Windows, it is terminated at once. The `Promise` is then rejected with the `CancelledError` once the program has ended, its output dropped; a program that it started goes on. The `Promise` is rejected with `cannot run: <command>` if the program cannot start, including when the command, an argument, the directory or a variable's value holds a NUL byte, or its input cannot be written to a temporary file, in the directory that `make_temp_dir` uses, with `cannot read the output of: <command>` if its output or errors cannot be read, and with `the output is too long: <command>` if either goes past `output_limit`, which stops the program as a cancel does, its output dropped. Throws a `ValueError` for options that are not valid (below). |
| `RunOptions` | A struct of the options of `run`, each of which may be left out. `stdin: Binary?`: the bytes that the program reads as its standard input, from a temporary file that is removed once the program has it, or else this program's standard input. `stdout: Byte[]?` and `stderr: Byte[]?`: arrays that the program's standard output and error are appended to once it ends, or else shared with this program. `cwd: String?`: the directory the program runs in, or else this program's. `env: Map<String, String>`: variables set for the program, besides this program's, replacing those of the same names; `unset_env: String[]`: this program's variables that the program is not given; on Windows, names are compared without case. `output_limit: Int?`: the most bytes that the program may write to each of `stdout` and `stderr`, or no limit. `kill_after = 5.0`: the seconds that a cancel waits for the program to end before it kills it. A name that is empty or holds `=` or a NUL byte, a name set twice (on Windows, in another case) or both set and removed, and a negative `output_limit` or `kill_after` throw a `ValueError`. |
| `Exit` | A struct of how a program ended: `code: Int`, its exit code, which a signal makes 128 plus its number, as shells do; and `signal: Int?`, that signal, on POSIX systems. On Windows, the code of a program that an exception or `TerminateProcess` ended is a non-negative 32-bit value, such as 3221225477 (0xC0000005) for an access violation; this case is not tested yet. |
| `env(name: String): String?` | The value of an environment variable, or nil if it is not set, including for a name that holds `=` or a NUL byte. Throws a `ValueError`, `the environment variable <name> is not valid UTF-8`, if the value is not. |
| `platform: String` | The system the program runs on: `'linux'`, `'macos'` or `'windows'`. |
| `cpu_count: Int` | The number of CPUs that the program may run on when the module runs, at least 1. |
| `process_id: Int` | The ID of the program's process. |
| `is_running(id: Int): Bool` | Whether a process with the ID is running, including one that the program may not signal. An ID of 0 or below, or beyond those the system gives, is not. |

## std:scanner

A `Scanner` reads a `String` by code points, as a lexer does: it looks at the next one before passing over it, and takes the text of what it has passed over, without byte offsets, which only `Binary` has (see [String](types.md#string)). It only ever stands at the start of a code point, so what it gives is a `String` without a check. It is a struct of functions that share where it stands, which only the functions that `scan` makes see and move.

```lerta
import scan from 'std:scanner'

scanner := scan('width = 42')
name := scanner.take_while((c) -> c != ' ')
scanner.take ' = '
print "#{name}: #{scanner.rest()}"
```

| Name | |
|---|---|
| `scan(text: String): Scanner` | A Scanner at the start of the text. |
| `s.done(): Bool` | Whether it has passed over the whole text. |
| `s.peek(): Char?` | The next code point, which it stays before, or nil at the end. |
| `s.next(): Char?` | The next code point, which it passes over, or nil at the end. |
| `s.take(prefix: String): Bool` | Whether what follows starts with `prefix`, which it passes over if it does. Every text starts with `''`. |
| `s.skip_while(test: (Char) -> Bool)` | Passes over the code points that `test` holds for, up to the first that it does not, or to the end. |
| `s.take_while(test: (Char) -> Bool): String` | Likewise, and gives what it passed over, `''` if nothing. |
| `s.mark(): () -> String` | A function that gives what it has passed over since the mark, up to where it stands each time the function is called, so after `rest()` up to the end. |
| `s.rest(): String` | What is left, which it passes over, `''` at the end. |

## std:time

| Name | |
|---|---|
| `sleep(seconds: Float): Promise` | A promise that is resolved once at least the seconds have passed (a time of zero only lets other work run first), for a [function that awaits](functions.md#functions-that-await) to wait for. Throws a `ValueError`, `sleep for a negative time`, for a negative time. |
| `time(): Float` | The seconds since the Unix epoch, 1970-01-01T00:00:00Z, with their fraction, as the system's clock tells them; it may go back if the clock is set back. |
