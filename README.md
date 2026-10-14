# Lerta

Lerta is a statically typed, compiled language with CoffeeScript-like syntax and TypeScript-like type inference. It compiles to native code through LLVM.

The name comes from the Esperanto word *lerta*, meaning "skillful", "deft" or "good at".

The language as planned (for what works today, see `docs/reference/`):

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

Early development. The compiler is written in Lerta (`compiler/`) and builds itself, starting from a seed, its own LLVM IR. What is left is in `docs/roadmap/`.

## Repository layout

| Path | Contents |
|---|---|
| `seed/` | The seed, the compiler's own LLVM IR, from which `make` builds it (see `docs/internals.md`) |
| `test/` | Test scripts in TypeScript, for Node.js: `run.ts` the run tests (`node test/run.ts --target <triple>` builds them for another target), `cli.ts` the command line, `runtime.ts` runtime checks no Lerta program can trigger; `lerta.ts` (where the repository and the compiler are), `report.ts` (running and reporting checks), `expect.ts` (what checks expect of the programs they run) and `target.ts` (`--target`) are shared by them |
| `tools/` | `test_cross.sh`, which `make test-cross` runs, and the Docker images it uses in `docker/` |
| `compiler/` | The compiler: `lexer/` and `parser/`, which builds the tree of `ast.lerta`, `loader.lerta`, which reads the modules of a program, `checker/`, which checks them, and `codegen/`, which emits LLVM IR, behind the commands of `main.lerta` |
| `runtime/` | C runtime |
| `third_party/` | libuv, with its license, and `libuv.txt`, which says how the runtime builds it for each system. Its license notice goes with the compiler, and with the programs it builds (see `docs/reference/compiler.md`) |
| `tests/` | Run tests: Lerta source and expected output |
| `examples/` | Example programs, run as tests (expected output in `tests/examples/`) |
| `docs/` | Documentation (see below) |
| `editors/` | Editor support for VS Code and Vim; see the README in each subdirectory to install it |

## Documentation

| Document | Contents |
|---|---|
| `docs/philosophy.md` | Design principles and the reasons behind major decisions |
| `docs/reference/` | Language reference. It covers only what is implemented and grows with the implementation |
| `docs/internals.md` | Implementation design: execution model, memory management, the LLVM interface |
| `docs/roadmap/` | Planned design of what is not implemented yet, and open questions |

## Building

Requirements: make and `clang` (LLVM); for the tests, also Node.js (22.18 or later in 22, or 23.6 or later, where type stripping is on by default) and, for their checks, pnpm. The programs run on Linux, macOS and Windows; the compiler and the tests run on Linux and macOS, and Windows programs are built with mingw-w64 (`--target x86_64-w64-mingw32`).

```
make                   # bin/lerta, the compiler, built from the seed
make TARGET=<triple>   # bin/lerta-<triple>, the compiler for another target
make check-bootstrap   # the compiler builds itself to the same IR (TARGET builds the stages for it)
make seed              # rewrites the seed, only when needed (see docs/internals.md)
make test              # builds bin/lerta, then runs the tests and check-bootstrap, on the host only
make test-cross        # the tests for every environment but the host's own (see below)
make clean
cd test && pnpm install && pnpm check   # type and format checks of test/
```

`make` rebuilds only when the seed, `compiler/`, `std/`, `runtime/` or `tools/embed.lerta` change. The bootstrap and the seed are described in [docs/internals.md](docs/internals.md#bootstrap). The tests run at a low priority (`nice`), with Node.js running the TypeScript directly, so there is no build step. `make test-cross` runs the tests as 32-bit Linux programs and as 64-bit and 32-bit Windows programs (mingw-w64 and Wine), with the bootstrap through a compiler for each, each on the host if it can run them; on a host other than Linux, it runs `make test` on Linux in Docker too. The targets run at the same time, so their outputs come one after another once all are done. What the host cannot run goes to Docker when Docker runs it without emulation, which for the 32-bit and the Windows programs takes an x86-64 host. It ends with what ran and what was skipped, and why: on an Apple silicon Mac, for instance, it runs Linux in Docker, and Windows only with mingw-w64, lld and Wine installed, and its bootstrap only with a clang for Windows (such as [llvm-mingw](https://github.com/mstorsjo/llvm-mingw)'s) on Wine's `PATH` (`WINEPATH`) too, and skips 32-bit Linux. To compile a program (see [the compiler](docs/reference/compiler.md)):

```
bin/lerta build examples/hello.lerta [-o hello] [-O]
```
