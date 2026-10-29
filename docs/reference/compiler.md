# Compiler

`lerta` is `bin/lerta`, which `make` builds (see the [README](../../README.md)); it carries the standard modules and the runtime in it, so it needs no other file of the repository. It is built with `-O --memory-checks` (see [build](#build)), so a leak of its own ends it with exit code 23 after its work, and a use of an object after it is dropped stops it. Arguments that do not fit a command's usage print the usage to stderr and exit with code 2. An argument that starts with `-` is taken as an option, but for the value of `-o` and `--target`, which is the next argument whatever it starts with; a path that starts with `-` is written as `./-name.lerta`.

## Commands

### build

```
lerta build <source> [<file>...] [-o <output>] [-O] [--memory-checks] [-Werror] [--no-trace]
            [--source-lines] [--target <triple>]
```

builds an executable. Usage errors are an unknown or repeated option, a missing source, a file after it of another kind than below, an option without its value, and, without `-o`, a source whose name does not end with `.lerta`, as `std:<name>` does not.

- `<source>` is a file, or a standard module as `std:<name>`, such as `std:io`, which is then the program, read from those the compiler carries; an unknown one prints `unknown standard module 'std:<name>'` and exits with code 1. The same holds for the commands below. A file of `std/` given by its path is an ordinary module, which imports the carried `std:builtins` as any other does: `std/process.lerta` builds, while `std/builtins.lerta` fails, as the extends of the files it exports from repeat those of the carried `std:builtins`.
- `<file>...`, after the source, are files that clang links with the program as it is given them: C (`.c`), LLVM IR (`.ll`), objects (`.o`, `.obj`) and archives (`.a`, `.lib`), such as those that define the C functions of the program's own [externs](functions.md#c-functions). With `-O`, clang compiles `.c` and `.ll` files with `-O2 -flto=thin` as it does the program; objects and archives built without it link too.
- `-o <output>` names the executable. Without it, the executable is the source's name without `.lerta`, in the current directory, as `go build` names it: `lerta build examples/hello.lerta` writes `hello`, or `hello.exe` for a Windows target. An output that is a module of the program or one of the files, by whatever path, is not written: the build prints `the output '<output>' is an input of the build` and exits with code 1.
- Without `-O`, or with `--memory-checks`, the program checks for leaked memory when it ends. The objects that nothing in use holds, as those of a cycle and what they hold, are reported to stderr as `leak: <n> unreachable object(s): <type> (<count>), ...`, by the types of the objects, in the order the first of each was made: a class's or a struct's name, `box of <type>` for a value held as a union's, `var` for a captured `var`, `<function>.<anonymous>` for a function literal's closure, and `Array`, `Map`, `Map cursor`, `Promise`, `Iter`, `String or Binary` and `weak box` for the builtin ones. When the program ends by finishing its top-level code, what else is left alive, as a function that awaits a promise that is never settled, is reported after them as `leak: <n> object(s)`; through `exit`, what is in use is not released, so only the objects that nothing in use holds are reported. A program that reports a leak ends with exit code 23, in place of its own, so that a leak fails it as any error does; one built with `-O` alone, which does not check, keeps its own. An exit through an uncaught throw is not checked, since it ends the program in the middle of its work.
- `-O` optimizes, including across the modules and the runtime (link-time optimization, ThinLTO), each module on a thread of its own. The linker keeps what it has optimized in [the cache](#cache), so that a build optimizes again only the modules that have changed, and those that inline from them; a `.c` or `.ll` file linked with the program is an exception, as clang compiles it into a temporary file of its own, which every build optimizes again, as it does what inlines from it.
- `--memory-checks` keeps the checks of a build without `-O` in a build with it: of leaks, above, and of the use of an object after it is dropped, which stops the program. Without `-O`, it changes nothing.
- `-Werror` makes a warning stop the build, as an error does: the warnings are printed, and the exit code is 1. The bootstrap builds the compiler so (see [internals](../internals.md#bootstrap)).
- `--no-trace` leaves out the trace that an uncaught exception prints (see [errors](errors.md#exceptions)), and with it the names of the functions and the files and the positions that the trace tells, which the program would otherwise hold. The symbols of the executable still name the functions, unless it is stripped.
- `--source-lines` gives the program debug information of where its code comes from in the source, the file, the line and the column of each statement and expression, for a debugger and for the backtrace of a panic or a crash, as `f at main.lerta:3:3`; it holds no names of locals nor their values. A file is named by its absolute path, which a debugger may show as a directory and a name, and a standard module as `std:<name>`. On macOS, the information goes into `<output>.dSYM` beside the program, which `dsymutil` makes, as the objects that the program would read it from are removed. On Windows, it goes into the program itself, as on Linux, for gdb or lldb to read; WinDbg and Visual Studio read a PDB instead, which is not made. It is off by default, and changes nothing else of the program.
- `--target <triple>` has clang build the executable for that target, such as `i686-linux-gnu` or `x86_64-w64-mingw32`; without it, the executable is for the host. A Windows target (`*-w64-mingw32`) needs mingw-w64, and lld, which links it. The runtime is built for Linux targets with glibc or musl (`*-linux`, `*-linux-gnu*`, `*-linux-musl*`), macOS ones (`*-darwin*`, `*-macos*`) and Windows ones; another, such as `x86_64-unknown-freebsd` or `aarch64-linux-android`, is reported as `not a target that the runtime is built for: <triple>`, and the build exits with code 1. This tells only the system; what else a target lacks, such as its C library's headers, clang reports.
- The build leaves no other file but [the cache](#cache): it writes the LLVM IR of each module to a temporary directory, which clang compiles, all modules at once, and links, and removes the directory after clang has built the executable, or failed to. An error while the directory is there removes it too: a file that cannot be written, or a program that cannot be started, clang or the one that `run` runs.

### run

```
lerta run <source> [<file>...] [-O] [--memory-checks] [-Werror] [--no-trace] [--source-lines]
          [-- <arg>...]
```

is provisional, until it runs the program directly with JIT (see [the roadmap](../roadmap/programs.md#tools)). It builds the program as `build` does, from the same source and files, in the temporary directory, and runs it, in the current directory, with the arguments after `--`, which go to the program as they are, even those that look like options; the program shares the standard streams. It then removes the directory, as `build` does, and exits with the program's exit code, or, if a signal ended it, 128 plus the signal number (see `run` in [std:process](std.md#stdprocess)). `-o` and `--target` are usage errors, and so is an argument for the program without `--`. A compile error or a failure of clang is reported as by `build`, and nothing runs.

### fmt

```
lerta fmt [--fix] <path>...
```

checks that each file is in the [style](style.md).

- **Paths.** The paths are files, and directories, whose `.lerta` files it takes, in the order of their names and through the directories inside them, but for those whose names start with `.`. `--fix` must come first; no path, or another argument that starts with `-`, is a usage error.
- **Reports.** It prints each file again from its syntax tree, in the style, and reports each place where the file differs from that, as a diagnostic is: `<path>:<line>:<column>: <message> (<rule>)`, where the rule is named by its bold label in the style, once for each line, or each run of lines, that differs; a run of a different number of lines, as where lines are joined or broken, is reported once, at its first difference, and what else breaks the style in it once that is fixed.
- **Programs checked.** It also checks a program that holds the file, reading the modules that it imports: that of which a file given that no other file given imports is the entry module, once for all the files given that it holds, and for the other files given, their own. If the program does not check, the types of its entry module are kept and its errors are not reported; the other files it holds are checked as the entry modules of their own programs.
- **Type annotations left out.** It leaves out the types written in the file that its checking shows the checker can infer (see **Type annotations** in the style), of those that the style leaves out:
  - a parameter's type that the function type expected, or a literal default, gives it;
  - a variable's or a field's type that its value has of its own, not from where it is (not an empty array or map, a number that the type makes a `Byte` or a `Float`, a string of one character that it makes a `Byte`, a member of an enum, a function literal, or a call of a generic function or a construction of a generic type), as do the parts of an array, a map or a tuple, and give together the branches of a conditional, a `case`, an `if` or a `try`;
  - a return type that the results give in this way, together (`T` and `nil` give `T?`), in a `Promise` for a function that awaits, or `void` for a function that gives no value, but not that of a function that uses itself, directly or through other functions.

  It does not leave out the other types that the checker could infer, such as those of functions that call each other. To be sure, it checks the program without them, and keeps those without which it does not check to the same types, conversions and warnings, such as a type that alone uses an import other than an enum's (see **Imports of enums and structs left out**), found by halving them.
- **Enum members written alone.** It writes alone a member of an enum written with its enum, `E.MEMBER`, where the checking of its program shows that E is expected (see **Expected types** in the style) and nothing takes the name, but not in the body of a generic function, nor where the expected type comes from the member only as it is written, as the left operand of `==`, the first item of an array and an argument of a call of a generic function for a parameter whose type names a type parameter. It checks the program without them, with the types it leaves out, and keeps those without which it does not check the same.
- **Structs constructed with `{}`.** It writes a construction of a struct, `S(x: 1)`, as `{ x: 1 }` where the checking of its program shows that S is expected (see **Expected types** in the style), but not in the body of a generic function, nor where the expected type comes only from the other items of an array or a map, nor as the left operand of `==`. It decides these first, checking the program without them, and keeps those without which it does not check the same; then the types and the enums of members, with those it writes so, so that a type that the constructions take is kept.
- **Named arguments written alone.** It writes a named argument of a construction of a class or a struct that is a variable of its name, `Point(y: 2, x: x)`, as the name alone, `Point(x, y: 2)` (see **Shorthand** in the style), where the named arguments it then goes before are names, `@`, literals or members of these, whose values that order does not change; but not in the body of a generic function, nor a named argument of a call of a function, which a name alone would pass as positional.
- **Emptiness tests written with `is_empty`.** It writes a test of a length against 0, `x.length == 0`, `x.length != 0` or `x.length > 0`, the first two with the operands either way round, and a comparison of a `String` with `''`, `s == ''` or `s != ''`, either way round too, as `x.is_empty()` or `not x.is_empty()` (see **Emptiness tests** in the style), where the checking of its program shows that x is an array, a map, a set, a `Binary` or a `String`, whose `is_empty` std gives, and `not (x.length != 0)` as `x.is_empty()`; not that of another type, of an optional, in the body of a generic function, or in the element or the guard of a comprehension or in an interpolation, which are printed as written.
- **Arms of one body.** It writes arms of a `case` with a subject next to each other whose bodies are written alike as one arm of their patterns, in their order (see **Shared arm bodies** in the style), where the checking of its program shows that the program checks the same with the subject narrowed to the union of their types, but for the types in that body, which narrowing changes there; not an arm of `nil`, nor in the body of a generic function, nor arms with a comment from the line where the first starts, which the arm kept could not hold where it is. It decides them before the rewrites other than records, which are then checked with the arms made one.
- **Copies written as spreads.** It writes a construction whose named arguments copy the fields of the same names of one value, `Point(x: 1, y: p.y)`, with a spread of that value first and the other arguments, `Point(p..., x: 1)` (see **Spreads** in the style), where the value is a name, `@` or a path of fields from one, and the checking of its program shows that it is of the type constructed and that the construction gives every argument, as the spread would give those it leaves to their defaults; and where the arguments before the last copy that are not copies have no effects, which the spread, read first, could see. Not in the body of a generic function.
- **Casts left out.** It leaves out a cast that throws, `x as T!`, of a value that the checking of its program shows to be a `T` already, as narrowing makes it (see **Redundant casts** in the style), but not in the body of a generic function, whose instances may give the value other types. It checks the program without them, with the others, and keeps those without which it does not check the same, such as one whose value an optional is expected of, which would then be converted to it.
- **Imports of enums and structs left out.** That an import of an enum is no longer used once the types and the enums of members are left out, or that of a struct once its constructions are written with `{}`, does not count in those checks: it leaves out the name from the import, and the import if it takes no other name, and reports it under **Expected types**.
- **Code kept as written.** A comment `# fmt: skip` that ends a line keeps that line as it is written, and one on a line of its own the next line of code; the lines from a comment `# fmt: off` up to a comment `# fmt: on`, or to the end of the file, are kept likewise. A line of a statement on lines of its own keeps all the lines of the statement, or of the innermost one, where statements in its blocks hold it: a line of an `if`'s block keeps that statement alone, but one of a list keeps all of it, and so does an arm on the line of its `when` keep the whole `case`, and a member the whole class. The statement is printed as it is written, with its comments, its types and the enums of its members, and with the imports that it uses, but indented as its block is, and its lines after the first as much deeper or shallower than the first as they were, but none shallower than the first column. The blank lines and the comments between such statements are printed as elsewhere. A file in which `# fmt: off` comes before the code, and no `# fmt: on` after it, is not even parsed: it is left as it is written, blank lines and comments too, and reported in nothing, even if it does not parse.

  ```
  identity := [  # fmt: skip
    1, 0
    0, 1
  ]
  ```
- **`--fix`** writes the files that differ instead, and reports nothing else.
- **What it keeps.** The comments, and the blank lines, at most one in a row; the spelling of literals, such as `0xFF` and the escapes of a string, but `'...'` for a string that can be written so; and the names of a destructuring.
- **Exit code.** 1 if a file differs (without `--fix`), and if a path names nothing (`'<path>' is not a file or a directory`), a file is not valid UTF-8 or does not parse (its compile error), and 0 otherwise; the other files are still taken.
- **Self-check.** Before it reports or writes, it parses the text that it printed: if that is another program, which would be a bug of the formatter, it reports `<path>: the formatter would change the program, which is a bug` and leaves the file.

What of the style it does not apply yet, and its known faults, are in [the roadmap](../roadmap/programs.md#tools).

### lsp

```
lerta lsp
```

is a language server, of the [Language Server Protocol](https://microsoft.github.io/language-server-protocol/), over stdin and stdout, for an editor to start; it takes no arguments.

- **Documents.** It takes a document's whole text on each change (`TextDocumentSyncKind.Full`), and reads the open documents' texts in place of their files, for each program that holds them. A document of a URI that is not `file:` is left alone; one that is no file yet is formatted, but not checked.
- **Diagnostics.** When a document is opened or changed, it checks the program whose entry module is that document, as `lerta build` does but without generating code, and publishes the errors and warnings of each file of the program, the standard modules left out, warnings once there are no errors, as `lerta build` gives them: a diagnostic's range is the one position of its message. Each module is checked with its statements that parse, in blocks too, so that a program is checked while it is being written, and a file whose statements do not all parse has only its parse errors. It checks again the open documents whose programs hold the document, and does so too when a document is closed, then from its file. A file's diagnostics are those of all the open documents' programs that hold it; one that none finds any in is published empty.
- **Positions.** In UTF-32 units, code points, as diagnostics count columns, if the client says it takes them (`general.positionEncodings`), and in UTF-16 units otherwise.
- **Formatting.** `textDocument/formatting` gives the document as `lerta fmt --fix` would write it, as one edit of the whole text, or none if it is in the style already, and `null` if it does not parse.
- **Hover and definition.** `textDocument/hover` gives the types of the name at the position, as `name: Type` in a block of Lerta, one line for each type it has in the instances of a generic function or class it is in; `textDocument/definition` gives where it is declared: a local, a parameter, a top-level value, a function, an import, a class, struct or enum member, a field or a method, own or of an extend, and the class, struct, interface, enum or alias that a type name names, as in an annotation or the enum of `Color.RED`. They answer from the last check of the document's program, or of an open document's program that holds it, as far as it was checked, and give nothing for a name that the checker gave no type, as a builtin type's name or a type parameter, or whose declaration is in a standard module.
- **Completion.** `textDocument/completion` gives what may be written where a name is being written, the name under the cursor replaced: after `.` or `@`, the members of the value's type, without nil after `?.` (its fields, its methods and those of the extends in effect there, and the builtin methods and properties of its kind), the exports of a module imported as a name, or the members of an enum and its `parse`; elsewhere, the locals that the code there sees, the innermost of a name, the module's names and those it imports, as declared, and std:builtins' exports, top-level code seeing only the top-level values it has declared, and the keywords. Each item has its kind and, where it is known, its type. It checks the program with the cursor's name replaced by one of its own and takes what the checker found where it met that name, so it gives nothing where the checker does not meet it: in a comment, a string or a type, in the body of a generic function that no call checks, and after an error earlier in the same function's body. The methods of extends of interfaces, and an enum's member written alone where the enum is expected, are not offered yet.
- **Other messages.** A request of another method is answered with the error `MethodNotFound`, one whose params are not of the method's shape with `InvalidParams` (with what `decode_json` found), a message that is not JSON with a parse error, and a bug of the server with `InternalError`, its message on stderr; another notification is ignored. A header without a length ends the server with status 1, as the next message cannot be found; `exit` ends it with 0 after `shutdown`, and with 1 otherwise.

### Dumps

The commands below print what the lexer, the parser, the checker and codegen make of the source. They are there for debugging the compiler. Each takes one argument, the source: more, or one that starts with `-`, is a usage error.

```
lerta dump-tokens <source>
```

prints the tokens of one file, without reading the modules it imports, one per line: `<line>:<column> <spaced|joined> <kind> "<text>"`, where `spaced` means that whitespace or the start of the line precedes it. An interpolated string is followed by its parts, indented: `text "<text>"` and `code <column> "<source>"`. In the quoted texts, the characters below U+0020, U+007F, `\` and `"` are written as `\xHH`. A lexical error is reported as a compile error.

```
lerta dump-ast <source>
```

prints the syntax tree of one file, likewise. A node is a line `<kind> <line>:<column>`, followed by its other fields, one per line and in the order of their names, indented under it: `<name>: <value>` for a value, written as in `dump-tokens` for a string and `-` for none, and `<name>:` followed by the contents on the next lines, indented further, for a node, a group of fields without a kind, or a list, whose items each follow a `-` line (or `- <value>` for a value). An empty list is `[]`. A group of fields without a kind that has a position writes it as its fields `line` and `column`. A syntax error is reported as a compile error.

```
lerta dump-checked <source>
```

loads and checks the program as `build` does, without generating code. For each module that is not a standard module, in the order they are loaded, it prints a line `module <path>`, with the path as given for the entry module and as diagnostics write it for the others, then the module's syntax tree as `dump-ast` prints it, as loaded, with the implicit import of `std:builtins`. The header line of each node that the checker gave a type is followed by ` : <type>`, and by ` => <type>` if the node is converted where it is used, such as an `Int` passed as an `Int?`; types are written as in messages. The bodies of generic functions, which are checked only for each use, have no types. Warnings and errors are reported as by `build`. The rest of what the checker works out (the captures of closures, the shared variables, the instances of generic functions and their checked bodies, the exports, the extends and the objects) is not printed.

```
lerta dump-llvm <source>
```

prints the LLVM IR that `build` has clang compile, before optimization, with the modules as one rather than one each. It names no target, so it is the same for every one; `build` also gives every function the attributes of the target, from [the cached runtime](#cache). Warnings and errors are reported as by `build`.

## Cache

The runtime, with [libuv](../internals.md#platforms), which the compiler carries the sources of, is compiled once for each kind of build and kept in a cache, so that a build only links it, with the system's libraries that libuv needs. An executable so holds libuv: given to others, it goes with libuv's license notice, `third_party/libuv/LICENSE`. An optimized build keeps what ThinLTO optimizes there too.

- **Where.** In `$LERTA_CACHE_DIR`, or else the system's place for caches: on Linux and macOS, `$XDG_CACHE_HOME/lerta`, or else `~/.cache/lerta`, and without `HOME` either, the build prints `no cache directory: set HOME or LERTA_CACHE_DIR`; on Windows, `%LOCALAPPDATA%\lerta`, and without `LOCALAPPDATA`, the build prints `no cache directory: set LOCALAPPDATA or LERTA_CACHE_DIR`. An empty variable counts as unset. The build exits with code 1 then, as it does with `cannot make the cache directory: <path>` if the directory cannot be made.
- **Names.** Each compiled runtime is a directory of its object files and `function_attributes.txt`, named so that a person can tell them apart, such as `runtime-debug-arm64-apple-darwin25.6.0-clang17-3F9A2C1D`: `debug`, or `release` with `-O`, or `release-checked` with `-O --memory-checks`; the target, or the host's as `clang --version` gives it; clang's major version; and a hash of the runtime's sources and libuv's, of clang's flags, of the names of the files it holds and of what `clang --version` prints, since `-flto` objects depend on clang's version. A target that holds `/` or `\` would name a path, and the build prints `not a target: <target>` and exits with code 1.
- **Builds at once.** A build compiles the runtime into a directory beside its place, named after it with `.staging-<process ID>-<name>` added, the name being that of the build's temporary directory, and renames that into place, so builds that run at once never see a part of one. If clang fails, nothing is left; a build killed meanwhile leaves its staging directory, which the next build that compiles the same runtime removes, as it does that of any process that is no longer running. Since it judges that by process IDs, which are those of its own system, a cache must not be shared with builds on another system or in another container, whose staging directories it would take as left. If the rename fails other than because another build has put the same runtime there, the build prints `cannot move the compiled runtime into the cache: <path>` and exits with code 1. A compiled runtime that has lost some of its objects is not compiled again, since a build may be linking with the others: the build prints `the cached runtime <path> is incomplete: remove it` and exits with code 1.
- **ThinLTO.** An optimized build has the linker keep what ThinLTO optimizes in `thinlto` in the cache directory, for every target, as the linker that clang uses by default takes it: ld64 for macOS, lld for Windows, and GNU ld with LLVM's plugin for Linux; a clang that links with lld for Linux fails an optimized build.
- Other failures of the file system, such as a cache directory that cannot be written, are reported as [std:io](std.md#stdio) reports them, as an uncaught error.
- **Removal.** Nothing else removes old runtimes, nor staging directories other than those above, such as one whose process ID another process now has: a person removes them, by their dates. The linker prunes `thinlto` by its own policy.

## Diagnostics

Diagnostics are printed to stderr, one per line:

```
<path>:<line>:<column>: <message>
<path>:<line>:<column>: warning: <message>
```

- A compile error stops the build, and the exit code is 1. The compiler goes on past an error to find the others, and reports them together, module by module in the order the modules are read, and in source order in each:
  - A syntax error ends its top-level statement alone; parsing goes on from the next top-level line, but for `else`, `catch` and `finally`, which continue the statement. The syntax errors of a module are reported without checking the program.
  - A type error ends the checking of the part of the program it is found in: a top-level statement, a function's or a method's body, an instance of a generic function, or the field initializers of a class or struct. What needs a part with an error, such as a call of a function whose return type the body with the error would tell, or a top-level value whose declaration has the error, is not checked, and reports no error of its own. An error in what the modules declare, such as their imports, ends the checking.
  - The warnings are printed before the errors; the names never used of the top-level code and the imports are not reported with errors, since the part with an error may use them.
- A warning does not stop the build, unless `-Werror` is given. Those of the standard modules are not reported, since the program cannot act on them; each standard module builds on its own without warnings.
- If `<source>` is not a file, `'<source>' is not a file` is printed, and the exit code is 1.
- If clang fails, its messages are printed as they are, and the exit code is 1.

Lines and columns start at 1, and columns count code points.
