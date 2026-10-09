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

Early development. The compiler is written in Lerta (`compiler/`) and builds itself, starting from a seed, its own LLVM IR. Next is completing the core of the language. See `docs/roadmap.md`.

## Repository layout

| Path | Contents |
|---|---|
| `seed/` | The seed, the compiler's own LLVM IR, from which `make` builds it (see `docs/internals.md`) |
| `test/` | Test scripts in TypeScript, for Node.js: `run.ts` the run tests (`node test/run.ts --target <triple>` builds them for another target), `cli.ts` the command line, `runtime.ts` runtime checks no Lerta program can trigger; `lerta.ts` (where the repository and the compiler are), `report.ts` (running and reporting checks) and `target.ts` (`--target`) are shared by them |
| `tools/` | `test_in_docker.sh` runs the tests on Linux, in Docker, and on x86-64 the run tests also as 32-bit programs and as 64-bit and 32-bit Windows programs (mingw-w64 and Wine), and the bootstrap through a 32-bit compiler |
| `compiler/` | The compiler: `lexer/` and `parser/`, which builds the tree of `ast.lerta`, `loader.lerta`, which reads the modules of a program, `checker/`, which checks them, and `codegen/`, which emits LLVM IR, behind the commands of `main.lerta` |
| `runtime/` | C runtime |
| `tests/` | Run tests: Lerta source and expected output |
| `examples/` | Example programs, run as tests (expected output in `tests/examples/`) |
| `docs/` | Documentation (see below) |
| `editors/` | Editor support for VS Code and Vim; see the README in each subdirectory to install it |

## Documentation

| Document | Contents |
|---|---|
| `docs/philosophy.md` | Design principles and the reasons behind major decisions |
| `docs/design/` | Planned language design that is not implemented yet |
| `docs/reference/` | Language reference. It covers only what is implemented and grows with the implementation |
| `docs/internals.md` | Implementation design: execution model, memory management, the LLVM interface |
| `docs/roadmap.md` | Phases, the self-hosting subset and open questions |

## Building

Requirements: make and `clang` (LLVM); for the tests, also Node.js (22.18 or later in 22, or 23.6 or later, where type stripping is on by default) and, for their checks, pnpm. The programs run on Linux, macOS and Windows; the compiler and the tests run on Linux and macOS, and Windows programs are built with mingw-w64 (`--target x86_64-w64-mingw32`).

```
make                   # bin/lerta, the compiler, built from the seed
make TARGET=<triple>   # bin/lerta-<triple>, the compiler for another target
make check-bootstrap   # the compiler builds itself to the same IR (TARGET builds the stages for it)
make seed              # rewrites the seed, only when needed (see docs/internals.md)
make test              # builds bin/lerta, then runs the tests and check-bootstrap, on the host only
make clean
tools/test_in_docker.sh
cd test && pnpm install && pnpm check   # type and format checks of test/, and spelling across the repository (cspell.json)
```

`make` rebuilds only when the seed, `compiler/`, `std/`, `runtime/` or `tools/embed.lerta` change. The bootstrap and the seed are described in [docs/internals.md](docs/internals.md#bootstrap). The tests run at a low priority (`nice`), with Node.js running the TypeScript directly, so there is no build step. To compile a program (see [the compiler](docs/reference/compiler.md)):

```
bin/lerta build examples/hello.lerta [-o hello] [-O]
```
