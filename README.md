# Lerta

Lerta is a statically typed language that compiles to native code through LLVM, with CoffeeScript-like syntax and TypeScript-like type inference. Lerta code has no undefined behavior, and its memory is managed without a tracing garbage collector. Against each of Go, Swift and Node.js, it is as fast or faster in most of [its benchmarks](bench/README.md).

```lerta
words := 'listen night silent stone enlist thing notes tones inlets'.split(' ')

groups: Map<String, String[]>
for word in words
  letters := [char for char in word].sorted().join()
  groups[letters, default: []].push(word)

print group.join(' ') for group in groups.values()
```

```output
listen silent enlist inlets
night thing
stone notes tones
```

- **Shape shows structure.** Blocks are marked by indentation alone, and the formatter lays out every program the same way.
- **Types, mostly inferred.** A function declares the types of its parameters. Its return type and the types of its variables are inferred, and all of them are checked at compile time.
- **Safe by default.** Lerta code has no undefined behavior: a value can be nil only where its type says so, and an index out of range or an integer overflow throws an exception.
- **Reference counting, with cycle checks.** An object is freed as soon as its last reference goes away, with no tracing garbage collector. Cycles are not collected: `weak` references break them, the compiler warns about those it can see, and debug builds report the objects that leak.
- **Single-threaded and event-driven.** Programs wait with `await` on an event loop, as in Node.js, and have no data races.

[lerta.org](https://lerta.org/) shows more of the language, and has [a tour](https://lerta.org/tour/) of it.

The name is the Esperanto word *lerta*, which means "skillful" or "deft".

## Status

Lerta is in early development: the language and its standard library may still change incompatibly. The compiler is written in Lerta and builds itself, starting from a seed of LLVM IR (see [the bootstrap](docs/internals/architecture.md#bootstrap)). It runs on Linux, macOS and Windows. What is planned, such as package management, a test runner, a REPL and a playground, is in [the roadmap](docs/roadmap/README.md).

Almost all of the code was written by AI coding agents, directed by the author. [AGENTS.md](AGENTS.md) describes how they work.

## Getting started

The compiler builds programs with clang, and the linker and C library that [Tools](docs/reference/compiler.md#tools) lists for each system (llvm-mingw on Windows): install them first.

Download the compiler for your system from [the releases](https://github.com/lerta-lang/lerta/releases). Its archive, `lerta-<version>-<target>.tar.gz`, named by [the target](docs/reference/compiler.md#--target-target), or `.zip` on Windows, holds it alone, `lerta` (`lerta.exe` on Windows), which carries the standard library and the runtime: put it in a directory on your `PATH`. The macOS one is not signed, so if a browser downloaded it, run `xattr -d com.apple.quarantine lerta` before it.

Write a program, `hello.lerta`:

```lerta
print 'hello, world'
```

and run it, or compile it into an executable:

```
lerta run hello.lerta
lerta build hello.lerta -O
./hello
```

`build` writes the executable, `hello`, into the current directory. `-O` optimizes it; without `-O`, the build is a debug build, which also checks the program's memory as it runs.

To build the compiler from source instead, you need make too. On Windows, use GNU make (for example, `winget install ezwinports.make`) and run it in Git Bash, the shell of [Git for Windows](https://gitforwindows.org/).

```
git clone https://github.com/lerta-lang/lerta
cd lerta
make
```

`make` builds the compiler, `bin/lerta` (`bin/lerta.exe` on Windows), which needs no other file from the repository.

From here, [the tour](docs/tour/README.md) shows the language, [the reference](docs/reference/compiler.md) lists every command and option, and [editors/](editors/) has editor support for VS Code and Vim.

## Documentation

| Document | Contents |
|---|---|
| [Tour](docs/tour/README.md) | An introduction to the language for programmers who know another one, in short programs with their output |
| [Philosophy](docs/philosophy.md) | The design principles, the goals for safety and performance, and what Lerta leaves out |
| [Reference](docs/reference/README.md) | The language, the standard library and the `lerta` command, as implemented |
| [Internals](docs/internals/README.md) | How the compiler and the runtime work: the architecture and the bootstrap, memory, the representation of values, iteration and awaiting, input and output, and the platforms |
| [Roadmap](docs/roadmap/README.md) | What is planned but not implemented yet, and the open questions |
| [Known issues](docs/issues.md) | The known defects: where each is, how to see it and how to fix it |

## Contributing

[CONTRIBUTING.md](CONTRIBUTING.md) describes the layout of the repository, how to build and test the compiler, the rules for changing the language, and the coding style.

## License

Lerta is licensed under either the [MIT License](LICENSE-MIT) or the [Apache License, Version 2.0](LICENSE-APACHE), at your option. The executables that the compiler builds include Lerta's runtime and standard library, libuv, and tables made from the Unicode Character Database: [`lerta license`](docs/reference/compiler.md#license) prints the notices that go with them. [CONTRIBUTING.md](CONTRIBUTING.md#licensing) says how contributions are licensed.
