# Compiler

```
lerta build <source> [<file>...] [-o <output>] [-O] [-Werror] [--target <triple>]
```

builds an executable. `lerta` is `bin/lerta`, which `make` builds (see the [README](../../README.md)); it carries the standard modules and the runtime in it, so it needs no other file of the repository. Arguments that do not fit this usage (an unknown or repeated option, a missing source, a file after it of another kind than below, a value that starts with `-`, or, without `-o`, a source whose name does not end with `.lerta`) print the usage to stderr and exit with code 2.

- `<source>` is a file, or a standard module as `std:<name>`, such as `std:io`, which is then the program, read from those the compiler carries; an unknown one prints `unknown standard module 'std:<name>'` and exits with code 1. The same holds for the commands below. A file of `std/` given by its path is an ordinary module, which imports the carried `std:builtins` as any other does: `std/process.lerta` builds, while `std/builtins.lerta` fails, as its extends repeat those of the carried `std:builtins`.
- `<file>...`, after the source, are files that clang links with the program as it is given them: C (`.c`), LLVM IR (`.ll`), objects (`.o`, `.obj`) and archives (`.a`, `.lib`), such as those that define the C functions of the program's own [externs](functions.md#c-functions). With `-O`, clang compiles `.c` and `.ll` files with `-O2 -flto=thin` as it does the program; objects and archives built without it link too.
- `-o <output>` names the executable. Without it, the executable is the source's name without `.lerta`, in the current directory, as `go build` names it: `lerta build examples/hello.lerta` writes `hello`, or `hello.exe` for a Windows target.
- Without `-O`, the program checks for leaked memory when it exits: a leak is reported to stderr as `leak: <n> object(s)`. It is only a warning: the exit code stays the program's own, so that one cycle does not fail a program whose output is right.
- `-O` optimizes, including across the modules and the runtime (link-time optimization, ThinLTO), each module on a thread of its own. The linker keeps what it has optimized in the cache (below), so that a build optimizes again only the modules that have changed, and those that inline from them.
- `-Werror` makes a warning stop the build, as an error does: the warnings are printed, and the exit code is 1. The bootstrap builds the compiler so (see [internals](../internals.md#bootstrap)).
- `--target <triple>` has clang build the executable for that target, such as `i686-linux-gnu` or `x86_64-w64-mingw32`; without it, the executable is for the host. A Windows target (`*-w64-mingw32`) needs mingw-w64, and lld, which links it. The runtime is built for Linux targets with glibc or musl (`*-linux`, `*-linux-gnu*`, `*-linux-musl*`), macOS ones (`*-darwin*`, `*-macos*`) and Windows ones; another, such as `x86_64-unknown-freebsd` or `aarch64-linux-android`, is reported as `not a target that the runtime is built for: <triple>`, and the build exits with code 1. This tells only the system; what else a target lacks, such as its C library's headers, clang reports.
- The build leaves no other file but the runtime's cache (below): it writes the LLVM IR of each module to a temporary directory, which clang compiles, all modules at once, and links, and removes the directory after clang has built the executable, or failed to. An error while the directory is there removes it too: a file that cannot be written, or a program that cannot be started, clang or the one that `run` runs.
- The runtime, with [libuv](../internals.md#platforms), which the compiler carries the sources of, is compiled once for each kind of build and kept in a cache, so that a build only links it, with the system's libraries that libuv needs. An executable so holds libuv: given to others, it goes with libuv's license notice, `third_party/libuv/LICENSE`.
- The cache:
  - **Where.** In `$LERTA_CACHE_DIR`, or else the system's place for caches: on Linux and macOS, `$XDG_CACHE_HOME/lerta`, or else `~/.cache/lerta`, and without `HOME` either, the build prints `no cache directory: set HOME or LERTA_CACHE_DIR`; on Windows, `%LOCALAPPDATA%\lerta`, and without `LOCALAPPDATA`, the build prints `no cache directory: set LOCALAPPDATA or LERTA_CACHE_DIR`. An empty variable counts as unset. The build exits with code 1 then, as it does with `cannot make the cache directory: <path>` if the directory cannot be made.
  - **Names.** Each compiled runtime is a directory of its object files and `function_attributes.txt`, named so that a person can tell them apart, such as `runtime-debug-arm64-apple-darwin25.6.0-clang17-3F9A2C1D`: `debug`, or `release` with `-O`; the target, or the host's as `clang --version` gives it; clang's major version; and a hash of the runtime's sources and libuv's, of clang's flags and of what `clang --version` prints, since `-flto` objects depend on clang's version. A target that holds `/` or `\` would name a path, and the build prints `not a target: <target>` and exits with code 1.
  - **Builds at once.** A build compiles the runtime into a directory beside its place, named after it with `.staging-<name>` added, and renames that into place, so builds that run at once never see a part of one. If clang fails, nothing is left; a build killed meanwhile leaves its staging directory. If the rename fails other than because another build has put the same runtime there, the build prints `cannot move the compiled runtime into the cache: <path>` and exits with code 1. A compiled runtime that has lost some of its objects is not compiled again, since a build may be linking with the others: the build prints `the cached runtime <path> is incomplete: remove it` and exits with code 1.
  - **ThinLTO.** An optimized build has the linker keep what ThinLTO optimizes in `thinlto` in the cache directory, for every target, as the linker that clang uses by default takes it: ld64 for macOS, lld for Windows, and GNU ld with LLVM's plugin for Linux; a clang that links with lld for Linux fails an optimized build.
  - Other failures of the file system, such as a cache directory that cannot be written, are reported as [std:io](modules.md#stdio) reports them, as an uncaught error.
  - **Removal.** Nothing removes old runtimes or staging directories: a person removes them, by their dates. The linker prunes `thinlto` by its own policy.

```
lerta run <source> [<file>...] [-O] [-Werror] [-- <arg>...]
```

is provisional, until it runs the program directly with JIT (see [the roadmap](../roadmap/programs.md#tools)). It builds the program as `build` does, from the same source and files, in the temporary directory, and runs it, in the current directory, with the arguments after `--`, which go to the program as they are, even those that look like options; the program shares the standard streams. It then removes the directory, unless a throw left it (see above), and exits with the program's exit code, or, if a signal ended it, 128 plus the signal number (see `run` in [std:process](modules.md#stdprocess)). `-o` and `--target` are usage errors, and so is an argument for the program without `--`. A compile error or a failure of clang is reported as by `build`, and nothing runs.

```
lerta fmt [--fix] <path>...
```

checks that each file is in the [style](style.md). The paths are files, and directories, whose `.lerta` files it takes, in the order of their names and through the directories inside them, but for those whose names start with `.`. It prints each file again from its syntax tree, in the style, and reports each place where the file differs from that, as a diagnostic is: `<path>:<line>:<column>: <message> (<rule>)`, where the rule is named by its bold label in the style, once for each line, or each run of lines, that differs; a run of a different number of lines, as where lines are joined or broken, is reported once, at its first difference, and what else breaks the style in it once that is fixed. With `--fix`, it writes the files that differ instead, and reports nothing else. It keeps the comments, and the blank lines, at most one in a row; the spelling of literals, such as `0xFF` and the escapes of a string, but `'...'` for a string that can be written so; and the names of a destructuring. The exit code is 1 if a file differs (without `--fix`), and if a path names nothing (`'<path>' is not a file or a directory`), a file is not valid UTF-8 or does not parse (its compile error), and 0 otherwise; the other files are still taken. Before it reports or writes, it parses the text that it printed: if that is another program, which would be a bug of the formatter, it reports `<path>: the formatter would change the program, which is a bug` and leaves the file. What of the style it does not apply yet is in [the roadmap](../roadmap/programs.md#tools).

The commands below print what the lexer, the parser, the checker and codegen make of the source. They are there for debugging the compiler.

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

loads and checks the program as `build` does, without generating code. For each module that is not a standard module, in the order they are loaded, it prints a line `module <path>`, with the path as given for the entry module and as diagnostics write it for the others, then the module's syntax tree as `dump-ast` prints it, as loaded, with the implicit import of `std:builtins`. The header line of each node that the checker gave a type is followed by ` : <type>`, and by ` => <type>` if the node is converted where it is used, such as an `Int` passed as an `Int?`; types are written as in messages. The bodies of generic functions, which are checked only for each use, have no types. Warnings and errors are reported as by `build`. The rest of what the checker works out (the captures of closures, the shared variables, the instances of generic functions and their checked bodies, the exports, the extensions and the objects) is not printed.

```
lerta dump-llvm <source>
```

prints the LLVM IR that `build` has clang compile, before optimization, with the modules as one rather than one each. It names no target, so it is the same for every one; `build` also gives every function the attributes of the target, from the cached runtime (below). Warnings and errors are reported as by `build`.

## Diagnostics

Diagnostics are printed to stderr, one per line:

```
<path>:<line>:<column>: <message>
<path>:<line>:<column>: warning: <message>
```

- A compile error stops the build, and the exit code is 1. Warnings found before it are printed first.
- A warning does not stop the build, unless `-Werror` is given. Those of the standard modules are not reported, since the program cannot act on them; each standard module builds on its own without warnings.
- If `<source>` is not a file, `'<source>' is not a file` is printed, and the exit code is 1.
- If clang fails, its messages are printed as they are, and the exit code is 1.

Lines and columns start at 1, and columns count code points.
