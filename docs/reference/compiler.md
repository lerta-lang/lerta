# Compiler

- `lerta` is `bin/lerta`, which `make` builds (see the [README](../../README.md)).
- It carries the standard modules and the runtime in it, so it needs no other file of the repository.
- It is built with `-O`, without the [memory checks](#memory-checks).

## Tools

`build` and `run` have `clang` on the `PATH` compile and link, and so need what it needs on the host:

| Host | Needs |
|---|---|
| Linux | `clang` (LLVM 15 or newer); GNU ld, with LLVM's plugin for `-O`; and the C library's development files, glibc's or musl's |
| macOS | Xcode's Command Line Tools (`xcode-select --install`) or Xcode, which have `clang`, the linker and the SDK |
| Windows | A clang for Windows, mingw-w64 and lld, which [llvm-mingw](https://github.com/mstorsjo/llvm-mingw) has all of |

A build for another target needs more (see [`--target`](#--target-target)).

## Arguments

- They are read by [std:args](std.md#stdargs): `lerta -h` lists the commands, and `lerta <command> -h` prints the usage of the command, with what each option does.
- Arguments that do not fit a command's usage print `lerta: ` and what does not fit, then the usage, to stderr, and exit with code 2.
- An argument that starts with `-` is taken as an option, but for `-` alone, a source, and the value of an option that takes one, as `-o`, `--target` and `--linker-flag`, which is the next argument whatever it starts with, or what follows `=` after a long option, as `--target=linux-amd64`. An option given twice is an error, but for `--linker-flag`.
- A path that starts with `-` is written as `./-name.lerta`.
- A `<source>`, in every command that takes one, is a file, or a standard module as `std:<name>`, such as `std:io`, read from those the compiler carries.
  - An unknown one prints `unknown standard module 'std:<name>'` and exits with code 1.
  - A source that is not a file prints `'<source>' is not a file` and exits with code 1.
  - A file of `std/` given by its path is an ordinary module, which imports the carried `std:builtins` as any other does.
  - `std/process.lerta` builds, while `std/builtins.lerta` fails, as the extends of the files it exports from repeat those of the carried `std:builtins`.
- A `<source>` may also be `-`, standard input, which is read to its end first.
  - Diagnostics name it `<stdin>`, and a trace names it so too.
  - Its imports of files are relative to the current directory.
  - Not valid UTF-8, it prints `<stdin> is not valid UTF-8` and exits with code 1.
  - What `run` runs reads its standard input after it.

## Commands

| Command | Does |
|---|---|
| [`build`](#build) | Builds an executable. |
| [`run`](#run) | Builds and runs a program. |
| [`fmt`](#fmt) | Checks or fixes the [style](style.md). |
| [`lsp`](#lsp) | Runs a language server. |
| [`cflags`](#cflags) | Prints the flag that finds the runtime's header. |
| [`clean`](#clean) | Empties the [cache](#cache). |
| [`license`](#license) | Prints the license notices that go with an executable. |
| [`dump-tokens`, `dump-ast`, `dump-checked`, `dump-llvm`](#dumps) | Print what the compiler makes of a source. |

### build

```
lerta build <source> [<file>...] [-o <output>] [-O] [--memory-checks] [--werror] [--no-trace]
            [--source-lines] [--eager-nan-checks] [--target <target>] [--linker-flag <flag>...]
```

Builds an executable.

Usage errors:

- an unknown or repeated option, or an option without its value;
- a missing source;
- a file after the source of another kind than [below](#linked-files);
- without `-o`, a source whose name does not end with `.lerta`, as `std:<name>` and `-` do not.

| Option | Effect |
|---|---|
| [`-o <output>`](#-o-output), `--output` | Names the executable. |
| [`-O`](#-o), `--optimize` | Optimizes, with ThinLTO. |
| [`--memory-checks`](#--memory-checks) | Keeps the memory checks with `-O`. |
| [`--werror`](#--werror) | Makes a warning stop the build. |
| [`--no-trace`](#--no-trace) | Leaves out the trace of an uncaught exception. |
| [`--source-lines`](#--source-lines) | Adds debug information of source positions. |
| [`--eager-nan-checks`](#--eager-nan-checks) | Checks each float operation for NaN. |
| [`--target <target>`](#--target-target) | Builds for another target. |
| [`--linker-flag <flag>`](#--linker-flag-flag) | Passes a flag to the linker. |

#### Linked files

- The `<file>`s after the source are files that clang links with the program as it is given them, such as those that define the C functions of the program's own [externs](functions.md#c-functions):

| Kind | Extensions |
|---|---|
| C | `.c` |
| Objective-C, for macOS | `.m` |
| LLVM IR | `.ll` |
| Objects | `.o`, `.obj` |
| Archives | `.a`, `.lib` |

- With `-O`, clang compiles `.c`, `.m` and `.ll` files with `-O2 -flto=thin` as it does the program. Objects and archives built without it link too.
- clang compiles `.c` and `.m` files with the flag that [`cflags`](#cflags) prints, so that they may include `lerta.h`.
- clang compiles `.m` files without ARC, as it is given no `-fobjc-arc`. The frameworks they use are linked with [`--linker-flag`](#--linker-flag-flag), as `--linker-flag -framework,AVFoundation`.
- While a program that links Apple's frameworks, which load CoreFoundation, or loads one later, waits, as in a `sleep`, the main thread's run loop runs, so that blocks on the main dispatch queue, timers, delegates and notifications reach it, on the main thread. The program still ends when its own work does, whatever the run loop has left.
- A `.m` file for a target other than macOS is not compiled: the build prints `'<file>' is Objective-C, which links only for macOS` and exits with code 1.

#### `-o <output>`

- Names the executable.
- Without it, the executable is the source's name without `.lerta`, in the current directory, as `go build` names it: `lerta build examples/hello.lerta` writes `hello`, or `hello.exe` for a Windows target.
- An output that is a module of the program or one of the linked files, by whatever path, is not written: the build prints `the output '<output>' is an input of the build` and exits with code 1.

#### `-O`

- Optimizes, including across the modules and the runtime (link-time optimization, ThinLTO), each module on a thread of its own.
- The linker keeps what it has optimized in [the cache](#cache), so that a build optimizes again only the modules that have changed, and those that inline from them.
- A `.c`, `.m` or `.ll` file linked with the program is an exception: clang compiles it into a temporary file of its own, which every build optimizes again, as it does what inlines from it.

#### Memory checks

Without `-O`, or with `--memory-checks`, the program checks its memory.

- **Use after drop.** The use of an object after it is dropped stops the program.
- **Unreachable objects.** When the program ends, the objects that nothing in use holds, as those of a cycle and what they hold, are reported to stderr:

  ```
  leak: <n> unreachable object(s): <type> (<count>), ...
  ```

  They are counted by type, in the order the first of each was made:

  | Type | Objects |
  |---|---|
  | `<name>` | a class's or a struct's |
  | `box of <type>` | a value held as a union's |
  | `var` | a captured `var` |
  | `<function>.<anonymous>` | a function literal's closure |
  | `Array`, `Map`, `Map cursor`, `Promise`, `Iter`, `String or Binary`, `weak box` | the builtin ones |

- **Objects left alive.** When the program ends by finishing its top-level code, what else is left alive, as a function that awaits a promise that is never settled, is reported after them as `leak: <n> object(s)`.
- Through `exit`, what is in use is not released, so only the objects that nothing in use holds are reported.
- An exit through an uncaught throw is not checked, since it ends the program in the middle of its work.
- A program that reports a leak ends with exit code 23, in place of its own, so that a leak fails it as any error does. One built with `-O` alone, which does not check, keeps its own.

#### `--memory-checks`

- Keeps the [memory checks](#memory-checks) of a build without `-O` in a build with it.
- Without `-O`, it changes nothing.

#### `--werror`

- Makes a warning stop the build, as an error does: the warnings are printed, and the exit code is 1.
- The bootstrap builds the compiler so (see [internals](../internals/architecture.md#bootstrap)).

#### `--no-trace`

- Leaves out the trace that an uncaught exception prints (see [errors](errors.md#exceptions)), and with it the names of the functions and the files and the positions that the trace tells, which the program would otherwise hold.
- The symbols of the executable still name the functions, unless it is stripped.

#### `--source-lines`

- Gives the program debug information of where its code comes from in the source: the file, the line and the column of each statement and expression.
  - It is for a debugger and for the backtrace of a panic or a crash, as `f at main.lerta:3:3`.
  - It holds no names of locals nor their values.
- A file is named by its absolute path, which a debugger may show as a directory and a name, and a standard module as `std:<name>`.

| System | Where the information goes |
|---|---|
| macOS | `<output>.dSYM` beside the program, which `dsymutil` makes, as the objects that the program would read it from are removed. |
| Linux | The program itself. |
| Windows | The program itself, for gdb or lldb to read. WinDbg and Visual Studio read a PDB instead, which is not made. |

- It is off by default, and changes nothing else of the program.

#### `--eager-nan-checks`

- Has each operation of `Float`s and `Float32`s check its result for NaN where it is, so that `not a number` is thrown by the operation that makes the NaN, before anything else runs, rather than where the value is used (see [Float](types.md#float)). A NaN that is never used throws too.
- The program is slower, as it checks more.
- It is there for finding where a NaN comes from.

#### `--target <target>`

- Has clang build the executable for that target. Without it, the executable is for the host. The host's own triple, as `clang -print-target-triple` prints it, counts as no target, so that the build shares the runtime of a build without one; a short name never does, since its triple may differ from the host's, as in the minimum macOS version or the C library.
- The target is a short name, `<system>-<architecture>`, or else a triple, such as `i686-linux-gnu`, which clang takes as it is:

| Short name | Triple |
|---|---|
| `linux-i386` | `i686-linux-gnu` |
| `linux-amd64` | `x86_64-linux-gnu` |
| `linux-arm64` | `aarch64-linux-gnu` |
| `macos-amd64` | `x86_64-apple-macos` |
| `macos-arm64` | `arm64-apple-macos` |
| `windows-i386` | `i686-w64-mingw32` |
| `windows-amd64` | `x86_64-w64-mingw32` |
| `windows-arm64` | `aarch64-w64-mingw32` |

- `macos-universal`, a short name with no triple of its own, builds the executable for both `macos-arm64` and `macos-amd64`, and has `lipo`, which Apple's tools have, join them into one. With `--source-lines`, its dSYM bundle holds both too.
- A Windows target (`*-w64-mingw32`, or `*-w64-windows-gnu` as llvm-mingw names it) needs mingw-w64, and lld, which links it.
- The runtime is built for these targets:

| System | Triples |
|---|---|
| Linux, with glibc or musl | `*-linux`, `*-linux-gnu*`, `*-linux-musl*` |
| macOS | `*-darwin*`, `*-macos*` |
| Windows | `*-w64-mingw32`, `*-w64-windows-gnu` |

- Another, such as `x86_64-unknown-freebsd` or `aarch64-linux-android`, is reported as `not a target that the runtime is built for: <triple>`, and the build exits with code 1.
- This tells only the system; what else a target lacks, such as its C library's headers, clang reports.

#### `--linker-flag <flag>`

- Passes the flag to the linker, as clang's `-Wl,<flag>` does, so that a comma splits it into arguments: `--linker-flag -framework,AVFoundation` passes `-framework` and `AVFoundation`.
- It may be given more than once; the flags go to the linker in the order given, after the program, the runtime and the [linked files](#linked-files), before the libraries.
- What a flag means is the linker's own, the one that clang uses by default (see [ThinLTO](#thinlto)).

#### Temporary files

- The build leaves no other file but [the cache](#cache).
- It writes the LLVM IR of each module to a temporary directory, which clang compiles, all modules at once, and links.
- It removes the directory after clang has built the executable, or failed to.
- An error while the directory is there removes it too: a file that cannot be written, or a program that cannot be started, clang or the one that `run` runs.

### run

```
lerta run <source> [<file>...] [-O] [--memory-checks] [--werror] [--no-trace] [--source-lines]
          [--eager-nan-checks] [--linker-flag <flag>...] [-- <arg>...]
```

- It is provisional, until it runs the program directly with JIT (see [the roadmap](../roadmap/programs.md#tools)).
- It builds the program as [`build`](#build) does, from the same source, files and options, in the temporary directory, for the host, into an executable named after the source's file name without `.lerta`, or `program` for `-`, which [`program`](std.md#stdprocess) gives.
- It runs it in the current directory, with the arguments after `--`, which go to the program as they are, even those that look like options. The program shares the standard streams.
- It then removes the directory, as `build` does.
- It exits with the program's exit code, or, if a signal ended it, 128 plus the signal number (see `run` in [std:process](std.md#stdprocess)). An exit code outside 0 to 255, as the NTSTATUS of a Windows program that crashes, becomes 255.
- Usage errors: those of `build`, and `-o` and `--target`, which it does not take.
- A compile error or a failure of clang is reported as by `build`, and nothing runs.

### fmt

```
lerta fmt [--fix] <path>...
```

Checks that each file is in the [style](style.md). What of the style it does not apply yet, and its known faults, are in [the roadmap](../roadmap/programs.md#tools).

#### Paths

- The paths are files, and directories, whose `.lerta` files it takes, in the order of their names and through the directories inside them, but for those whose names start with `.`.
- No path is a usage error.

#### Reports

- It reports each place where the file is not in the style, as a diagnostic is:

  ```
  <path>:<line>:<column>: <message> (<rule>)
  ```

  - each gap between its tokens and comments that the style decides otherwise: the spaces, the line start and its indentation, the blank lines;
  - each [rewrite](#rewrites) of its tokens that the style asks for.

  The rule is named by its heading in the style: the one that decides the gap, or that asks for the rewrite.
- What a rewrite changes in the layout of the statement that holds it is reported once the rewrite is made.
- A comment that it cannot place where it is, as one after a `(` that opens an operand, is reported under [Comments](style.md#comments) with a message saying to move it, and its statement keeps its gaps as written.
- A line over 100 columns that it keeps or writes, such as one of a comment, a string or an operation that stays on one line (see [Long operations](style.md#long-operations)), which it cannot break, is reported under [Line length](style.md#line-length) with a message saying to shorten it by hand: one that it keeps at its 101st column, but one [kept as written](#code-kept-as-written).

#### `--fix`

- Writes the files that differ instead of reporting them: rewritten, and laid out, in rounds, as a rewrite may enable others, until nothing changes, for at most 32 rounds.
- Reports what remains: the lines over 100 columns, and the rewrites that are only reported, which are left to be made by hand:
  - those of the [rewrites](#rewrites) below that say so;
  - a `not` of an `and` or an `or` (see [Negated conditions](style.md#negated-conditions));
  - a two-way value written as an `if` that fits on a line as `c then a else b`, or written `c then a else b` where it fits neither on its line nor on the next, which an `if` then writes (see [Branches](style.md#branches));
  - a long two-way value or a chain of them where no block can take it, as in an operand (see [Branches](style.md#branches));
  - a comprehension on one line with a long part where it cannot write it with its `for` first, as in an argument (see [Comprehensions](style.md#comprehensions));
  - a change of the layout that a rewrite of tokens would make, as the commas between items or the brackets of a literal, where it would take out a comment;
  - a comment that it cannot place.

#### What it keeps

- The comments, and the blank lines, at most one in a row, adding one before a comment that starts a paragraph (see [Blank lines](style.md#blank-lines)).
- The spelling of literals, such as `0xFF` and the escapes of a string, but `'...'` for a string that can be written so.
- The names of a destructuring.

#### Exit code

- 1 if:
  - a file differs (without `--fix`);
  - a file holds what remains after `--fix` (with `--fix`);
  - a path names nothing (`'<path>' is not a file or a directory`);
  - a file is not valid UTF-8 or does not parse (its compile error is reported);
  - the [self-check](#self-check) finds a fault of the formatter.
- 0 otherwise.
- The other files are still taken.

#### Self-check

- Before it reports or writes, it parses the text that it writes, after each round.
- If that does not parse, or is another program than the rewrites make, which would be a fault of the formatter, it reports `<path>: its rewrites would not parse: <error>, which is a fault of the formatter`, or `... would change the program ...`, or `... would make the program fail to check ...` where the program checked, `its layout ...` for the layout, and leaves the file.

#### Programs checked

The rewrites below depend on the checking of a program that holds the file.

- It reads the modules that the program imports.
- A file given that no other file given imports is the entry module of a program, checked once for all the files given that it holds. The other files given are checked as their own.
- If the program does not check, the types of its entry module are kept and its errors are not reported. The other files it holds are checked as the entry modules of their own programs.
- A file of a module of std, in a directory `std/` that holds `builtins.lerta`, as the repository's, is checked as that module, `std:<name>`, which may declare what only std may, with the modules of std that are not given as the compiler carries them.

#### Rewrites

| Rewrite | Style rule |
|---|---|
| [Type annotations left out](#type-annotations-left-out) | [Type annotations](style.md#type-annotations) |
| [Enum members written alone](#enum-members-written-alone) | [Expected types](style.md#expected-types) |
| [Structs constructed with `{}`](#structs-constructed-with-) | [Expected types](style.md#expected-types) |
| [Types written once](#types-written-once) | [Expected types](style.md#expected-types) |
| [Named arguments written alone](#named-arguments-written-alone) | [Shorthand](style.md#shorthand) |
| [Values written alone](#values-written-alone) | [Values alone](style.md#values-alone) |
| [Default comparisons left out](#default-comparisons-left-out) | [Default comparisons](style.md#default-comparisons) |
| [Arrays of Iterables left out](#arrays-of-iterables-left-out) | [Iterable arguments](style.md#iterable-arguments) |
| [Chars added themselves](#chars-added-themselves) | [Char concatenations](style.md#char-concatenations) |
| [Found tests written with `any`](#found-tests-written-with-any) | [Found tests](style.md#found-tests) |
| [Membership tests written with `in`](#membership-tests-written-with-in) | [Membership tests](style.md#membership-tests), [Negated in tests](style.md#negated-in-tests) |
| [Membership lists written with `in`](#membership-lists-written-with-in) | [Membership lists](style.md#membership-lists) |
| [Range tests written with `in`](#range-tests-written-with-in) | [Range tests](style.md#range-tests) |
| [Ranges written with fewer parts](#ranges-written-with-fewer-parts) | [Ranges](style.md#ranges) |
| [Emptiness tests written with `is_empty`](#emptiness-tests-written-with-is_empty) | [Emptiness tests](style.md#emptiness-tests) |
| [Arms of one body](#arms-of-one-body) | [Shared arm bodies](style.md#shared-arm-bodies) |
| [Copies written as spreads](#copies-written-as-spreads) | [Spreads](style.md#spreads) |
| [Casts left out](#casts-left-out) | [Redundant casts](style.md#redundant-casts) |
| [Unused names left out](#unused-names-left-out) | [Unused names](style.md#unused-names) |

- None is made in the body of a generic function, whose instances may give its values other types.
- Those that say they are only reported are left to be made by hand: `--fix` does not make them.

#### Type annotations left out

It leaves out the types written in the file that its checking shows the checker can infer, of those that the style leaves out:

- a parameter's type that the function type expected, or a literal default, gives it;
- a variable's or a field's type that its value has of its own, not from where it is:
  - of an array, a map or a tuple, the type that its parts have so;
  - of a conditional, a `case`, an `if` or a `try`, the type that its branches give together;
- a return type that the results give in this way, together (`T` and `nil` give `T?`), in a `Promise` for a function that awaits, or `void` for a function that gives no value; but not that of a function that uses itself, directly or through other functions.

Not where the type comes from where it is:

- an empty array or map;
- a number that the type makes a `Byte` or a `Float`, a `Binary` literal of one byte that it makes a `Byte`;
- a member of an enum, a function literal;
- a call of a generic function or a construction of a generic type.

Besides:

- It does not leave out the other types that the checker could infer, such as those of functions that call each other.
- It keeps a type that names an import, which leaving it out could leave unused.
- It is checked: once the rounds end, the types of the declarations and the functions of the program rewritten, checked again, must be those of the file; where they are not, or the program does not check, it keeps every type of the file.

#### Enum members written alone

- It writes a member of an enum written with its enum, `E.MEMBER`, alone where `E` is expected and nothing takes the name.
- Not where the expected type comes from the member only as it is written:
  - the left operand of `==`;
  - the first item of an array;
  - an argument of a call of a generic function for a parameter whose type names a type parameter.

#### Structs constructed with `{}`

- It writes a construction of a struct, `S(x: 1)`, as `{ x: 1 }` where `S` is expected.
- Not where the expected type comes only from the other items of an array or a map, nor as the left operand of `==`.
- A construction without parentheses is written so too, its arguments running to the end of its line or of the block below it: `{` for the name, and `}` after the arguments, on a line of its own where they take lines.
- A construction of type arguments is only reported.

#### Types written once

- It writes the type of a variable or a field without one, from the values that give it: the items of an array literal, or else the value itself, or the values of its branches, of `then`/`else`, a `case`, an `if` or a `try`, and of those inside them.
- It writes the return type of a function without one that is the value of such a variable or field, from its results: the values that it returns and its last value, and the values of their branches likewise. Not of a function that awaits or yields, nor of a generic one or one in generic code.
- Where two or more of those values, of the type or of the type that it makes optional, are members of the enum written with it, `E.A`, whose names nothing takes, or constructions of the struct, not generic, that give an argument but a value alone: or one or more, for the items of an array of a struct.
- The type is written as the first of them names it, `[]` after it for an array, and `?` for an optional; in the same edit, each of them is written alone or as a record, as without them the type would be left out again (see [Type annotations left out](#type-annotations-left-out)): `xs := [E.A, E.B]` as `xs: E[] = [A, B]`, `f := (n: Int) -> n == 0 then S(x: 0) else S(x: n)` as `f := (n: Int): S -> n == 0 then { x: 0 } else { x: n }`.

#### Named arguments written alone

- It writes a named argument of a construction of a class or a struct that is a variable of its name, `Point(y: 2, x: x)`, as the name alone, `Point(x, y: 2)`.
- From the first named argument, up to one that is not written alone: one after such an argument, which would go before it, is only reported.
- Not a named argument of a call of a function, which a name alone would pass as positional.

#### Values written alone

- It writes a construction of a class or a struct that gives by its name only the one argument that must be given, `ValueError(message: 'bad')`, as its value alone, `ValueError('bad')`.
- Not where the value is a name of an argument of the type, which alone would give that argument instead, nor the same field of another value, which is a spread (see [Copies written as spreads](#copies-written-as-spreads)), nor a record, `{ message: 'bad' }`.

#### Default comparisons left out

- It writes `xs.sorted((a, b) -> a.compare(b))` of an array, whose comparison is that which `sorted` takes by default, as `xs.sorted()`, and so for `sort`, with or without parentheses.

#### Arrays of Iterables left out

- It writes `Set(xs.to_array())` as `Set(xs)`, and so for `Map()`, where `xs` is an array, an Iter, a map or a set, as they take any Iterable.

#### Chars added themselves

- It writes `s + c.to_string()` of a `String` `s` and a `Char` `c` as `s + c`, and `s += c.to_string()` as `s += c`, as `+` of a `String` appends a `Char`.

#### Found tests written with `any`

- It writes `xs.find(f) != nil` as `xs.any(f)`, and `xs.find(f) == nil` as `not xs.any(f)`, where `xs` is an array, an Iter or a map, whose items `find` takes only where they are not optional, so its nil is only that of none found.

#### Membership tests written with `in`

- It writes `xs.contains(x)`, a call of `contains` of one argument, as `x in xs`, and `not xs.contains(x)` as `x not in xs`.
- Only where the object and the argument are names, `@`, fields of them or literals, which run no code, and the call gives a `Bool`.
- Not in an interpolation, which is kept as written.

#### Membership lists written with `in`

- It writes a run of two or more tests of one value joined by `or`, `x == A or x == B`, as `x in [A, B]`, and by `and`, `x != A and x != B`, as `x not in [A, B]`, in a chain of `or`s or of `and`s, which may hold other tests before or after them.
- Only where `x` is a name, `@` or a field of them, which runs no code, of an integer, a `Char`, a `Bool`, an enum or a `String`, and each item is a literal, a member of an enum or a constant: `in` then evaluates `x` once and makes no array, and the items run no code that `or` would have skipped.

#### Range tests written with `in`

- It reports two comparisons joined by `and` that test a value against a start and an end, `x >= a and x <= b` or `a <= x and x < b`, the second either way round, which may be written `x in a..=b` or `x in a..b`, after the `and`s before them in a chain. They are only reported.
- So for two joined by `or` that test it outside, `x < a or x > b` or `x < a or x >= b`, which may be written `x not in a..=b` or `x not in a..b`, after the `or`s before them.
- Only where the value, written the same in both, and the end are names, `@`, fields of them or literals, which run no code, as `and` evaluates the end only where the first holds, and `or` only where it fails, and the value is a number or a `Char`.
- Not in the places that [membership tests](#membership-tests-written-with-in) are not written in.

#### Ranges written with fewer parts

- It writes a range `a..(b + 1)` as `a..=b` where `b` is an integer, as the ends of a range in a `for` or an index are. The range then no longer throws where `b + 1` would overflow.
- In an index, it leaves out:
  - a start `0`, but where no end follows;
  - an end that is the length of what it indexes, `xs[i..xs.length]` written `xs[i..]`, where that is a name, `@` or a field of them, written the same.

#### Emptiness tests written with `is_empty`

- It writes these as `x.is_empty()` or `not x.is_empty()`:
  - a test of a length against 0, `x.length == 0`, `x.length != 0` or `x.length > 0`, the first two with the operands either way round;
  - a comparison of a `String` with `''`, `s == ''` or `s != ''`, either way round too.
- It writes `not (x.length != 0)` as `x.is_empty()`.
- Only where `x` is an array, a map, a set, a `Binary` or a `String`, whose `is_empty` std gives; not that of another type, nor of an optional.
- Not in an interpolation, which is kept as written.

#### Arms of one body

- It reports arms of a `case` with a subject next to each other whose bodies are written alike, which may be one arm of their patterns, in their order. They are only reported.
- Not where the body may read the subject, whose type narrowing to the union of their types would change there:
  - a name, or a path of fields from one, where the body names that name;
  - a path of fields from `@`, which a method may read through;
  - any other subject but a call, or a path of fields from one.
- Not an arm of `nil`, nor arms with a comment from the line where the first starts, which the arm kept could not hold where it is.

#### Copies written as spreads

- It reports a construction whose named arguments copy the fields of the same names of one value, `Point(x: 1, y: p.y)`, which may be written with a spread of that value first and the other arguments, `Point(p..., x: 1)`. It is only reported.
- Only where:
  - the value is a name, `@` or a path of fields from one;
  - it is of the type constructed;
  - the construction gives every argument, as the spread would give those it leaves to their defaults;
  - the arguments before the last copy that are not copies have no effects, which the spread, read first, could see.

#### Casts left out

- It leaves out a cast that throws, `x as T!`, of a value that is a `T` already, as narrowing makes it, where the checking shows it.

#### Unused names left out

- It leaves out the names that an import takes and the module never uses, with the commas between them.
- An import that takes no name that is used, or a module alias that is not, is only reported, as the import runs the module's top-level code and brings its extends: `import 'module'` keeps them.
- So is one whose last name left out a comment follows, which would then follow a name kept.
- Not an import that exports its names, which the modules that import it use.

#### Code kept as written

```lerta
identity := [  # fmt: skip
  1, 0
  0, 1
]
```

| Comment | Keeps |
|---|---|
| `# fmt: skip` that ends a line | that line |
| `# fmt: skip` on a line of its own | the next line of code |
| `# fmt: off` up to `# fmt: on`, or to the end of the file | the lines between |

- A line of a statement on lines of its own keeps all the lines of the statement, or of the innermost one, where statements in its blocks hold it:
  - a line of an `if`'s block keeps that statement alone;
  - one of a list keeps all of it;
  - an arm on the line of its `when` keeps the whole `case`, and a member the whole class.
- The statement keeps its gaps as written, and no rewrite is made in it.
- A statement on lines that hold a [`;`](syntax.md#statements) is not kept, as it shares a line with another.
- It is indented as its block is, and its lines after the first as much deeper or shallower than the first as they were, but none shallower than the first column.
- The blank lines and the comments between such statements are printed as elsewhere.
- A file in which `# fmt: off` comes before the code, and no `# fmt: on` after it, is not even parsed. It is left as it is written, blank lines and comments too, and reported in nothing, even if it does not parse.

### lsp

```
lerta lsp
```

A language server, of the [Language Server Protocol](https://microsoft.github.io/language-server-protocol/), over stdin and stdout, for an editor to start. It takes no arguments.

| Method | Answer |
|---|---|
| `textDocument/didOpen`, `didChange`, `didClose` | [Diagnostics](#diagnostics-of-documents) |
| `textDocument/formatting` | [Formatting](#formatting) |
| `textDocument/hover` | [Hover](#hover-and-definition) |
| `textDocument/definition` | [Definition](#hover-and-definition) |
| `textDocument/completion` | [Completion](#completion) |

#### Documents

- It takes a document's whole text on each change (`TextDocumentSyncKind.Full`).
- It reads the open documents' texts in place of their files, for each program that holds them.
- A document of a URI that is not `file:` is left alone.
- One that is no file yet is formatted, but not checked.

#### Positions

- In UTF-32 units, code points, as diagnostics count columns, if the client says it takes them (`general.positionEncodings`).
- In UTF-16 units otherwise.

#### Diagnostics of documents

- When a document is opened or changed, it checks the program whose entry module is that document, as `lerta build` does but without generating code.
- It publishes the errors and warnings of each file of the program, the standard modules left out, as `lerta build` gives them, warnings once there are no errors.
- A diagnostic's range is the one position of its message.
- Each module is checked with its statements that parse, in blocks too, so that a program is checked while it is being written. A file whose statements do not all parse has only its parse errors.
- It checks again the open documents whose programs hold the document. It does so too when a document is closed, then from its file.
- A file's diagnostics are those of all the open documents' programs that hold it. One that none finds any in is published empty.

#### Formatting

- `textDocument/formatting` gives the document as `lerta fmt --fix` would write it, as one edit of the whole text.
- None if it is in the style already, and `null` if it does not parse.

#### Hover and definition

- `textDocument/hover` gives the types of the name at the position, as `name: Type` in a block of Lerta, one line for each type it has: in a generic function or class, the one at its definition, in which a type parameter stands for itself, then those in its instances.
- `textDocument/definition` gives where it is declared:
  - a local, a parameter, a top-level value, a function, an import;
  - a class, struct or enum member, a field or a method, own or of an extend;
  - the class, struct, interface, enum or alias that a type name names, as in an annotation or the enum of `Color.RED`.
- They answer from the last check of the document's program, or of an open document's program that holds it, as far as it was checked.
- They give nothing for a name that the checker gave no type, as a builtin type's name or a type parameter, or whose declaration is in a standard module.

#### Completion

`textDocument/completion` gives what may be written where a name is being written, the name under the cursor replaced.

| Where | Items |
|---|---|
| After `.` or `@` | The members of the value's type, without nil after `?.`: its fields, its methods and those of the extends in effect there, and the builtin methods and properties of its kind. |
| | The exports of a module imported as a name. |
| | The members of an enum and its `parse`. |
| Elsewhere | The locals that the code there sees, the innermost of a name; the module's names and those it imports, as declared; std:builtins' exports; the keywords. Top-level code sees only the top-level values it has declared. |

- Each item has its kind and, where it is known, its type.
- It checks the program with the cursor's name replaced by one of its own, and takes what the checker found where it met that name.
- So it gives nothing where the checker does not meet it: in a comment, a string or a type, and after an error earlier in the same function's body.
- In a generic body, which is checked at its definition first, a type parameter's members are those that its bound gives.
- Not offered yet: the methods of extends of interfaces, and an enum's member written alone where the enum is expected.

#### Other messages

| Message | Answer |
|---|---|
| A request of another method | The error `MethodNotFound` |
| A request whose params are not of the method's shape | `InvalidParams`, with what `decode_json` found |
| A message that is not JSON | A parse error |
| A bug of the server | `InternalError`, its message on stderr |
| Another notification | Ignored |
| A header without a length | Ends the server with status 1, as the next message cannot be found |
| `exit` | Ends the server with 0 after `shutdown`, and with 1 otherwise |

### cflags

```
lerta cflags
```

- Prints `-I<dir>`, the flag that has clang find `lerta.h`, the runtime's header, which declares what C files linked with a program may use, as `LertaString`: `clang -c $(lerta cflags) file.c`.
- `<dir>` is an absolute path, which is split by the shell where it holds a space.
- It writes the header into the [cache](#cache) first if it is not there, in `include-<hash>`, the hash being of the header, in 16 hex digits as a runtime's (see [Names](#names)).
- It takes no arguments.
- A failure to find the directory, as without `HOME`, is reported as by a build.

### clean

```
lerta clean
```

- Removes what builds keep in the [cache](#cache), in the directory that a build would take, of this compiler or an earlier one:
  - each entry whose name starts with `runtime-`: the compiled runtimes and their staging directories;
  - each entry whose name starts with `include-`: the runtime's headers that [`cflags`](#cflags) writes;
  - `thinlto`, and each entry whose name starts with `thinlto-devirt-`: the linker's ThinLTO caches.
- It prints `removed <path>` for each, in the order of their names, but for one that a build renames or removes meanwhile, as it does with its staging directory.
- It leaves anything else that the directory holds, as one that `$LERTA_CACHE_DIR` names may hold more.
- Without the directory, it removes nothing and makes none.
- The next build compiles the runtime again. A build that runs meanwhile may fail, as what it links goes.
- It takes no arguments.
- A failure to find the directory, as without `HOME`, is reported as by a build.

### license

```
lerta license
```

- Prints the license notices that the compiler carries, which go with an executable given to others (see [Cache](#cache)): `LICENSE-MIT`, `LICENSE-APACHE`, `third_party/libuv/LICENSE` and `third_party/libuv/LICENSE-extra`, in that order, each under a line `== <path> ==`.
- It takes no arguments.

### Dumps

- These commands print what the lexer, the parser, the checker and codegen make of the source.
- They are there for debugging the compiler.
- Each takes one argument, the source: more, or an option, is a usage error.

| Command | Prints | Reads imports |
|---|---|---|
| `lerta dump-tokens <source>` | The tokens of one file | No |
| `lerta dump-ast <source>` | The syntax tree of one file | No |
| `lerta dump-checked <source>` | The checked syntax trees of the program | Yes |
| `lerta dump-llvm <source>` | The LLVM IR of the program | Yes |

#### dump-tokens

- One token per line: `<line>:<column> <spaced|joined> <kind> "<text>"`, where `spaced` means that whitespace or the start of the line precedes it.
- An interpolated string is followed by its parts, indented: `text "<text>"` and `code <column> "<source>"`.
- In the quoted texts, the characters below U+0020, U+007F, `\` and `"` are written as `\xHH`.
- A lexical error is reported as a compile error.

#### dump-ast

- A node is a line `<kind> <line>:<column>`, followed by its other fields, one per line and in the order of their names, indented under it:
  - `<name>: <value>` for a value, written as in `dump-tokens` for a string and `-` for none;
  - `<name>:` followed by the contents on the next lines, indented further, for a node, a group of fields without a kind, or a list.
- The items of a list each follow a `-` line, or are `- <value>` for a value. An empty list is `[]`.
- A group of fields without a kind that has a position writes it as its fields `line` and `column`, before the others.
- A syntax error is reported as a compile error.

#### dump-checked

- Loads and checks the program as `build` does, without generating code.
- For each module that is not a standard module, in the order they are loaded, it prints:
  - a line `module <path>`, with the path as given for the entry module and as diagnostics write it for the others;
  - the module's syntax tree as `dump-ast` prints it, as loaded, with the implicit import of `std:builtins`.
- The header line of each node that the checker gave a type is followed by ` : <type>`, and by ` => <type>` if the node is converted where it is used, such as an `Int` passed as an `Int?`. Types are written as in messages.
- The bodies of generic functions, which are checked only for each use, have no types.
- Not printed: the rest of what the checker works out: the captures of closures, the shared variables, the instances of generic functions and their checked bodies, the exports, the extends and the objects.
- Warnings and errors are reported as by `build`.

#### dump-llvm

- Prints the LLVM IR that `build` has clang compile, before optimization, with the modules as one rather than one each.
- It names no target, so it is the same for every one. `build` also gives every function the attributes of the target, from [the cached runtime](#cache).
- Warnings and errors are reported as by `build`.

## Cache

- The runtime, with [libuv](../internals/platforms.md#platforms), whose sources the compiler carries, is compiled once for each kind of build and kept in a cache. A build only links it, with the system's libraries that libuv needs.
- An executable holds Lerta's runtime and standard modules, and libuv: given to others, it goes with the notice of whichever of Lerta's licenses its distributor follows, `LICENSE-MIT` or `LICENSE-APACHE`, and libuv's, `third_party/libuv/LICENSE` and `third_party/libuv/LICENSE-extra`, which [`license`](#license) prints.
- The runtime's directory keeps the object of each standard module that a build compiles too, which a later build of the same module's code links instead of compiling it again (see [Names](#names)). A program's own modules are compiled each time, so that the cache does not grow with each change of them.
- A build that links a `.c` or `.m` file keeps the runtime's header there too (see [`cflags`](#cflags)), and an optimized build what ThinLTO optimizes.

### Where

| System | Directory |
|---|---|
| Any | `$LERTA_CACHE_DIR`, if set |
| Linux, macOS | `$XDG_CACHE_HOME/lerta`, or else `~/.cache/lerta` |
| Windows | `%LOCALAPPDATA%\lerta` |

- An empty variable counts as unset.
- These errors exit with code 1:

| Error | Cause |
|---|---|
| `no cache directory: set HOME or LERTA_CACHE_DIR` | On Linux and macOS, none of the variables is set. |
| `no cache directory: set LOCALAPPDATA or LERTA_CACHE_DIR` | On Windows, neither variable is set. |
| `cannot make the cache directory: <path>` | The directory cannot be made. |

- Other failures of the file system, such as a cache directory that cannot be written, are reported as [std:io](std.md#stdio) reports them, as an uncaught error.

### Names

- Each compiled runtime is a directory of its object files, `function_attributes.txt` and `coro_end_type.txt`, and of the objects of standard modules, `module-<hash>.o`, the hash being of the module's LLVM IR, in 16 hex digits as the runtime's.
- It is named so that a person can tell them apart, such as `runtime-debug-arm64-apple-darwin25.6.0-clang17-3F9A2C1D8E4B7065`:
  - the kind: `debug`, or `release` with `-O`, or `release-checked` with `-O --memory-checks`;
  - the target, or without one the host's, as `clang --version` gives it;
  - clang's major version;
  - a hash of 64 bits, in 16 hex digits, of the runtime's sources and libuv's, of clang's flags, of the names of the files it holds and of what `clang --version` prints, since `-flto` objects depend on clang's version.
- A target that holds `/` or `\` would name a path: the build prints `not a target: <target>` and exits with code 1.

### Builds at once

- A build compiles the runtime into a directory beside its place, named after it with `.staging-<process ID>-<name>` added, the name being that of the build's temporary directory.
- It renames that into place, so builds that run at once never see a part of one.
- If clang fails, nothing is left.
- A build killed meanwhile leaves its staging directory. The next build that compiles the same runtime removes it, as it does that of any process that is no longer running.
  - Since it judges that by process IDs, which are those of its own system, a cache must not be shared with builds on another system or in another container, whose staging directories it would take as left.
- If the rename fails other than because another build has put the same runtime there, the build prints `cannot move the compiled runtime into the cache: <path>` and exits with code 1.
- A standard module's object is written beside its place, named after it with `.staging-<process ID>-<name>` added, as a runtime's staging directory is, and renamed into place. A build killed meanwhile leaves that file, which only takes space.
- A compiled runtime that has lost some of its files is not compiled again, since a build may be linking with the others: the build prints `the cached runtime <path> is incomplete: remove it` and exits with code 1.

### ThinLTO

- An optimized build has the linker keep what ThinLTO optimizes in `thinlto-devirt-8` in the cache directory, for every target.
- The linker is the one that clang uses by default: ld64 for macOS, lld for Windows, and GNU ld with LLVM's plugin for Linux. A clang that links with lld for Linux fails an optimized build.
- The name carries an option of LLVM's that the build gives the linker, which the linker leaves out of the keys of its entries, so that builds with another value of it share none.

### Removal

- No build removes old runtimes, nor staging directories other than those above, such as one whose process ID another process now has.
- The linker prunes `thinlto-devirt-8` by its own policy only.
- [`lerta clean`](#clean) removes them all, a ThinLTO cache of another name, as `thinlto` of earlier compilers, too.

## Diagnostics

Diagnostics are printed to stderr, one per line:

```
<path>:<line>:<column>: <message>
<path>:<line>:<column>: warning: <message>
```

- Lines and columns start at 1, and columns count code points.
- If clang fails, its messages are printed as they are, and the exit code is 1.

### Errors

- A compile error stops the build, and the exit code is 1.
- The compiler goes on past an error to find the others, and reports them together, module by module in the order the modules are read, and in source order in each.
- **Syntax errors.** A syntax error ends its top-level statement alone. Parsing goes on from the next top-level line, but for `else`, `catch` and `finally`, which continue the statement. The syntax errors of a module are reported without checking the program.
- **Type errors.** A type error ends the checking of the part of the program it is found in:
  - a top-level statement;
  - a function's or a method's body, a generic one's at its definition;
  - an instance of a generic function;
  - the field initializers of a class or struct.
- What needs a part with an error, such as a call of a function whose return type the body with the error would tell, or a top-level value whose declaration has the error, is not checked, and reports no error of its own.
- An error in what the modules declare, such as their imports, ends the checking.

### Warnings

- A warning does not stop the build, unless [`--werror`](#--werror) is given.
- The warnings are printed before the errors.
- The names never used of the top-level code and the imports are not reported with errors, since the part with an error may use them.
- Those of the standard modules are not reported, since the program cannot act on them. Each standard module builds on its own without warnings.
