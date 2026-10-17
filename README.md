# Lerta

Lerta is a statically typed, compiled language with CoffeeScript-like syntax and TypeScript-like type inference. It compiles to native code through LLVM.

The name comes from the Esperanto word *lerta*, meaning "skillful", "deft" or "good at".

The language as planned (for what works today, see [the reference](docs/reference/README.md)):

```
struct Circle
  r: Float
  area = @r * @r * PI

const eval = (e: Expr): Int ->
  case e
    when Num then e.value
    when Neg then -eval(e.operand)
    when Plus then eval(e.left) + eval(e.right)

print "area: #{Circle(r: 2).area}"
```

## Status

Early development. The compiler is written in Lerta and builds itself, starting from a seed of LLVM IR (see [the bootstrap](docs/internals.md#bootstrap)). What is left is in [the roadmap](docs/roadmap/README.md).

## Getting started

Requirements: make and `clang` (LLVM). The programs run on Linux, macOS and Windows; the compiler runs on Linux and macOS, and builds Windows programs with mingw-w64 (`--target x86_64-w64-mingw32`).

`make` builds the compiler, `bin/lerta` (see [Building and testing](#building-and-testing)). To compile a program:

```
bin/lerta build examples/hello.lerta [-o hello] [-O]
```

The commands of the compiler are in [the reference](docs/reference/compiler.md).

## Documentation

| Document | Contents |
|---|---|
| [docs/philosophy.md](docs/philosophy.md) | Design principles and the reasons behind major decisions |
| [docs/reference/](docs/reference/README.md) | The external specification as implemented: the language, the standard modules and the commands, as a program and its user observe them. It grows with the implementation |
| [docs/internals.md](docs/internals.md) | The internal specification as implemented: execution model, memory management, the LLVM interface, the runtime and the bootstrap |
| [docs/roadmap/](docs/roadmap/README.md) | What is planned and not implemented yet, both external and internal, and open questions |

## Development

### Repository layout

| Path | Contents |
|---|---|
| `compiler/` | The compiler: `lexer/` and `parser/`, which builds the tree of `ast.lerta`, `loader.lerta`, which reads the modules of a program, `checker/`, which checks them, `codegen/`, which emits LLVM IR, and `format/`, behind the commands of `main.lerta`; `minilerta.lerta` is the entry the seed is made from |
| `std/` | The standard modules, in Lerta, which the compiler embeds |
| `runtime/` | The C runtime, which the compiler embeds |
| `seed/` | The seed, from which `make` builds the compiler (see [the bootstrap](docs/internals.md#bootstrap)) |
| `third_party/` | libuv, with its license, and `libuv.txt`, which says how the runtime builds it for each system. Its license notice goes with the compiler, and with the programs it builds (see [the reference](docs/reference/compiler.md)) |
| `tools/` | `embed.lerta`, which writes the module that embeds `std/` and `runtime/` into the compiler; `test_cross.sh`, which `make test-cross` runs, and the Docker images it uses in `docker/` |
| `test/` | The test scripts (see [Tests](#tests)) |
| `tests/` | Run tests: Lerta sources and their expected output; also the files of the CLI checks (`tests/cli/`) and the formatter cases (`tests/format/`) |
| `examples/` | Example programs, run as tests (expected output in `tests/examples/`) |
| `bench/` | Benchmarks, each in Lerta, C, Swift and JavaScript, and `run.lerta`, which builds them and prints their times next to each other (`bin/lerta run bench/run.lerta`) |
| `editors/` | Editor support for VS Code and Vim; see the README in each subdirectory to install it |

### Building and testing

The tests run on Linux and macOS, and also need Node.js (22.18 or later in 22, or 23.6 or later, where type stripping is on by default). `pnpm check` in `test/` (after `pnpm install`) checks the test scripts' types and style; run it when they change.

```
make                   # bin/lerta, the compiler, built from the seed
make TARGET=<triple>   # bin/lerta-<triple>, the compiler for another target
make test-bootstrap    # the compiler builds itself to the same IR (TARGET builds the stages for it)
make seed              # rewrites the seed, only when needed (see the bootstrap)
make test              # builds bin/lerta, then runs the tests and test-bootstrap, on the host only
make test-cross        # the tests for every environment but the host's own (see below)
make check             # the code in the style (lerta fmt)
make clean
```

`make` rebuilds only when what the compiler is built from changes: the seed, `compiler/`, `std/`, `runtime/`, `third_party/libuv` or `tools/embed.lerta`.

`make test-cross` runs the tests as 32-bit Linux programs and as 64-bit and 32-bit Windows programs (mingw-w64 and Wine), with the bootstrap through a compiler for each. On a host other than Linux, it also runs `make test` on Linux in Docker.

- Each runs on the host if the host can run it, and otherwise in Docker when Docker runs it without emulation, which for the 32-bit and the Windows programs takes an x86-64 host.
- The targets run at the same time, so their outputs come one after another once all are done. It ends with what ran and what was skipped, and why.
- On an Apple silicon Mac, for instance, it runs Linux in Docker and skips 32-bit Linux. It runs Windows only with mingw-w64, lld and Wine installed, and the Windows bootstrap only with a clang for Windows (such as [llvm-mingw](https://github.com/mstorsjo/llvm-mingw)'s) on Wine's `PATH` (`WINEPATH`) too.

### Tests

Every language feature gets run tests in `tests/`: a Lerta source file and its expected output, as described at the top of `test/run.ts`. Programs in `examples/` are run as tests too. The test scripts, in `test/`, are TypeScript that Node.js runs directly, with no build step, at a low priority (`nice`):

- `run.ts`: the run tests (`node test/run.ts --target <triple>` builds them for another target)
- `cli.ts`: the command line (its checks in `cli/`)
- `runtime.ts`: runtime checks that no Lerta program can trigger
- `format.ts`: the formatter, whose cases are the exact specification of the style
- `leaks.ts`: the compiler's own leaks, as the debug build of it, `build/stage1`, prints the IR of each source of `tests/` and `examples/` and of each standard module
- Shared by them: `lerta.ts` (where the repository and the compiler are, running it, and caching the runtimes before the tests), `report.ts` (running and reporting checks), `expect.ts` (what checks expect of the programs they run), `target.ts` (`--target`) and `wine.ts` (running Windows programs under Wine)

### Changing the language

- Implement a feature as [the roadmap](docs/roadmap/README.md) specifies it. When it is implemented, move its description to [the reference](docs/reference/README.md) or [the internals](docs/internals.md) and remove it from the roadmap.
- When a design question is not covered, apply [the principles](docs/philosophy.md) in priority order.
- Follow [the runtime rules](docs/internals.md#runtime-rules), and [the bootstrap](docs/internals.md#bootstrap) for which features the compiler may use.

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
