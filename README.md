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

Early development. The compiler is written in Lerta (`compiler/`) and builds itself; stage0, in TypeScript, builds it first. Next is completing the core of the language. See `docs/roadmap.md`.

## Repository layout

| Path | Contents |
|---|---|
| `stage0/` | Bootstrap compiler in TypeScript: `src/syntax/` reads the source, `src/check/` checks it, `src/codegen/` emits LLVM IR; `test/` runs the tests: `run.ts` the run tests, `cli.ts` the command line, `compiler.ts` the comparison of `compiler/` with stage0, `bootstrap.ts` the bootstrap, `runtime.ts` runtime checks no Lerta program can trigger |
| `tools/` | `test_in_docker.sh` runs the tests on Linux, in Docker, and on x86-64 the run tests also as 32-bit programs, and the bootstrap through a 32-bit compiler |
| `compiler/` | The compiler written in Lerta, ported from stage0 one layer at a time: so far `lexer/` and `parser/`, which builds the tree of `ast.lerta`, `loader.lerta`, which reads the modules of a program, `checker/`, which checks them, and `codegen/`, which emits LLVM IR, behind `build` (in `build.lerta`), `dump-tokens`, `dump-ast` and `dump-checked`; `build` and `dump-checked` take `--root <dir>`, the directory that holds `std/` and `runtime/`, which the compiler cannot find on its own yet |
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
| `docs/roadmap.md` | Phases, the stage0 subset and open questions |

## Building

Requirements: Node.js, pnpm, `clang` (LLVM).

```
cd stage0
pnpm install
pnpm check   # type and format checks, and spelling across the repository (cspell.json)
pnpm test
pnpm test:compare   # compiler/ against stage0, on every Lerta file of the repository
../tools/test_in_docker.sh
```

The run tests build each program with the compiler written in Lerta, which stage0 builds first; stage0 itself is checked by building it and by `pnpm test:compare`.

The tests run at a low priority (`nice`). stage0 runs its TypeScript directly with Node.js (22.18 or later), so there is no build step. To compile a program:

```
node stage0/src/main.ts build examples/hello.lerta -o hello [-O] [--emit-llvm hello.ll]
```

