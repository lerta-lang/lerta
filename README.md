# Lerta

Lerta is a statically typed, compiled language with CoffeeScript-like syntax and TypeScript-like type inference. It compiles to native code through LLVM.

The name comes from the Esperanto word *lerta*, meaning "skillful", "deft" or "good at".

The language as planned (for what works today, see [the reference](docs/reference/README.md)):

```
struct Circle
  r: Float
  area := @r * @r * PI

eval := (e: Expr): Int ->
  case e
    when Num then e.value
    when Neg then -eval(e.operand)
    when Plus then eval(e.left) + eval(e.right)

print "area: #{Circle(r: 2).area}"
```

## Status

Early development. The compiler is written in Lerta and builds itself, starting from a seed of LLVM IR (see [the bootstrap](docs/internals/architecture.md#bootstrap)). What is left is in [the roadmap](docs/roadmap/README.md).

## Getting started

`make` builds the compiler, `bin/lerta`, from the seed; what it needs is in [Building](#building). The programs run on Linux, macOS and Windows. To compile a program:

```
bin/lerta build examples/hello.lerta [-o hello] [-O]
```

The commands of the compiler are in [the reference](docs/reference/compiler.md).

## Documentation

| Document | Contents |
|---|---|
| [docs/philosophy.md](docs/philosophy.md) | Design principles and the reasons behind major decisions |
| [docs/reference/](docs/reference/README.md) | The external specification as implemented: the language, the standard modules and the commands, as a program and its user observe them. It grows with the implementation |
| [docs/internals/](docs/internals/README.md) | The internal specification as implemented: the architecture, the runtime rules and the bootstrap, the compiler, execution, memory, the representation of values, iteration and awaiting, input and output and the platforms |
| [docs/roadmap/](docs/roadmap/README.md) | What is planned and not implemented yet, both external and internal, and open questions |
| [docs/issues.md](docs/issues.md) | Known defects, with their severity and fix |

## Development

### Repository layout

| Path | Contents |
|---|---|
| `compiler/` | The compiler (see [below](#the-compiler)) |
| `std/` | The standard modules, in Lerta, which the compiler embeds |
| `runtime/` | The C runtime, which the compiler embeds |
| `seed/` | The seed, from which `make` builds the compiler (see [the bootstrap](docs/internals/architecture.md#bootstrap)) |
| `LICENSE-MIT`, `LICENSE-APACHE` | Lerta's licenses (see [License](#license)) |
| `third_party/` | libuv and its license; `libuv.txt` says how the runtime builds it for each system. Its license notice goes with the compiler and the programs it builds (see [License](#license)) |
| `tools/` | `embed.lerta`, which writes the module that embeds `std/` and `runtime/` into the compiler; `test_cross.sh`, which `make test-cross` runs; `docker/`, its Docker images, with `run.sh` to run a command (bash by default) in one |
| `test/` | The test driver and suites (see [Testing](#testing)) |
| `tests/` | The run tests: Lerta sources and their expected output; also the CLI checks' files (`tests/cli/`) and the formatter cases (`tests/format/`) |
| `examples/` | Example programs, run as tests (expected output in `tests/examples/`) |
| `bench/` | Benchmarks (see [Benchmarks](#benchmarks)) |
| `editors/` | Editor support for VS Code and Vim; each subdirectory's README says how to install it |

#### The compiler

| Path in `compiler/` | Role |
|---|---|
| `lexer/`, `parser/` | Build the tree of `ast.lerta` |
| `loader.lerta` | Reads the modules of a program |
| `checker/` | Checks them |
| `codegen/` | Emits LLVM IR |
| `format/` | The formatter |
| `main.lerta` | The commands |
| `minilerta.lerta` | The entry the seed is made from |

### Building

What the compiler is built and runs with, on each host:

| Host | Needs |
|---|---|
| Linux, macOS | make and `clang` (LLVM 15 or newer) |
| Windows | The shell of [Git for Windows](https://gitforwindows.org/), which `make` runs in; GNU make (such as `winget install ezwinports.make`); and a clang for Windows (such as [llvm-mingw](https://github.com/mstorsjo/llvm-mingw)'s), both on the `PATH`. The compiler is `bin/lerta.exe` |

The compiler builds programs for other targets with `--target` (see [the reference](docs/reference/compiler.md)): Windows programs with mingw-w64 and lld.

```
make                   # bin/lerta, the compiler, built from the seed
make TARGET=<target>   # bin/lerta-<target>, the compiler for another target
make test-bootstrap    # the compiler builds itself to the same IR (TARGET builds the stages for it)
make seed              # rewrites the seed, only when needed (see the bootstrap)
make clean
```

`make` rebuilds only when what the compiler is built from changes: the seed, `compiler/`, `std/`, `runtime/`, `third_party/libuv` or `tools/embed.lerta`.

### Testing

The tests run on Linux, macOS and Windows. A check of what only POSIX systems have, such as signals, does not run on Windows; nor do the tests of a `posix/` directory.

```
make test              # builds bin/lerta, then runs the tests and test-bootstrap, on the host only
make test-cross        # the tests for every environment but the host's own (see below)
make check             # the code in the style (lerta fmt)
```

- Every language feature gets run tests in `tests/`: a Lerta source and its expected output, as the top of `test/run.lerta` describes. Programs in `examples/` are run as tests too.
- `make check` checks the tests' style too. Code that breaks it on purpose, as a test of a form that the style rewrites, keeps it with `# fmt: skip` or `# fmt: off` (see [fmt](docs/reference/compiler.md#fmt)). A file that does not parse starts with `# fmt: off`.

#### Cross testing

`make test-cross` runs the tests, with the bootstrap through a compiler for each target, as:

- 32-bit Linux programs;
- 64-bit and 32-bit Windows programs (mingw-w64 and Wine);
- on a host other than Linux, also `make test` on Linux in Docker.

Where each runs:

- On the host if it can, otherwise in Docker when Docker runs it without emulation. The 32-bit and Windows programs then need an x86-64 host.
- The targets run one after another. It ends with what ran and what was skipped, and why. What a container skips, such as the Windows bootstrap in the Wine image without a clang for Windows, shows only in its output.
- For example, on an Apple silicon Mac it runs Linux in Docker and skips 32-bit Linux. Windows runs only with mingw-w64, lld and Wine installed; the Windows bootstrap also needs a clang for Windows (such as [llvm-mingw](https://github.com/mstorsjo/llvm-mingw)'s) on Wine's `PATH` (`WINEPATH`).

#### The driver

- `test/main.lerta`, the driver, is built by minilerta into `bin/test`, as `tools/embed.lerta` is. Why: a change to `compiler/` cannot break the harness that tests it.
- `make test` builds and runs it. It runs all the suites, or those named.
- Its options are listed at the top of `test/main.lerta`: `-k <text>` (checks whose names hold the text), `--failed` (those that failed last time), `--target <target>` (the run tests built for another target), and more.
- A failed check runs once more, alone, after the others, and passes as flaky if it passes then. `--no-retry` turns that off.

```
bin/test runtime            # the runtime checks alone
bin/test -k tests/string    # the checks whose names hold tests/string
bin/test --failed           # the checks that failed when they last ran
```

#### Suites

| Suite | File | Checks |
|---|---|---|
| `run` | `test/run.lerta` | The run tests |
| `cli` | `test/cli.lerta`, checks in `test/cli/*.lerta` | The command line |
| `format` | `test/format.lerta` | The formatter; its cases are the exact specification of the style |
| `runtime` | `test/runtime.lerta` | What no Lerta program can trigger: each check links a C program of `test/runtime/`, standing in for generated code, with the runtime |
| `leaks` | `test/leaks.lerta` | The compiler's own leaks and uses of dropped objects, which the bootstrap's stage2, built with the memory checks, reports while running `dump-llvm` and `fmt` on each test and example |
| `self` | `test/self.lerta` | The driver itself: it must report the tests of `tests/harness/` (most of which must fail, each as it should) and take its options as it says |

#### Modules

| Module in `test/lib/` | Role |
|---|---|
| `lerta` | Where the repository and the compiler are; running it; the run's directories; caching the runtimes before the tests |
| `report` | Selecting, running and reporting checks |
| `expect` | What checks expect of the programs they run |
| `target` | `--target` |
| `wine` | Running Windows programs under Wine |
| `cli` | Running the compiler in directories of its own |
| `lsp` | Sessions with the language server |

### Benchmarks

```
make bench             # the benchmarks' times
make bench-http        # the HTTP server's requests per second
```

- Each benchmark in `bench/` is written in Lerta, Swift, Go, JavaScript and C; C is the reference, built with the system's own compiler: cc, or cl on Windows. Each prints its `main.out`.
- On Windows, run `make bench` where `vcvars64.bat` has run, as in the x64 Native Tools Command Prompt, so that cl is on the PATH.
- `bench/run.lerta` (`make bench`) builds them and prints each language's version, their times side by side and each language's geometric mean. Where stdout is colored, the fastest other than C is bold.
- `bench/http/` holds an HTTP server in Lerta, Go and JavaScript. Its `run.lerta` (`make bench-http`) loads each with `load.lerta` and prints their requests per second.
- `bench/shared.lerta` holds what both runners use.
- The run tests build each Lerta source in `bench/`, and run each benchmark's `main.lerta`, whose stdout must be its `main.out`.

### Changing the language

- Implement a feature as [the roadmap](docs/roadmap/README.md) specifies it. When it is implemented, move its description to [the reference](docs/reference/README.md) or [the internals](docs/internals/README.md) and remove it from the roadmap.
- When a design question is not covered, apply [the principles](docs/philosophy.md) in priority order.
- Follow [the runtime rules](docs/internals/architecture.md#runtime-rules), and [the bootstrap](docs/internals/architecture.md#bootstrap) for which features the compiler may use.

### Coding style

Simplicity of the result comes first (KISS). Simplicity of the process does not matter.

Unless it conflicts with KISS:

- **DRY.** No duplicated logic.
- **Separation of concerns.** One module, one responsibility. Split long functions and classes.
- **Consistency.** Follow the naming and structure that already exist.
- **Least surprise.**

Let the code speak instead of relying on comments:

- Name things so that **what** they do is clear.
- Structure logic so that **how** it works is clear. Break complex parts into named intermediate values.
- Comment only the **why** that the code cannot show.

Documentation follows the same rules: no redundancy, no duplication, and a clear structure. State each fact in one place and point to it from elsewhere.

The style of Lerta code is in [the reference](docs/reference/style.md).

## License

Lerta is licensed under either of the [MIT License](LICENSE-MIT) or the [Apache License, Version 2.0](LICENSE-APACHE), at your option. Programs that the compiler builds hold Lerta's runtime and standard modules, and libuv; what goes with them is in [the reference](docs/reference/compiler.md#cache). How contributions are licensed is in [CONTRIBUTING.md](CONTRIBUTING.md).
