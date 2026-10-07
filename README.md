# Lerta

Lerta is a statically typed, compiled language with CoffeeScript-like syntax and TypeScript-like type inference. It compiles to native code through LLVM.

The name comes from the Esperanto word *lerta*, meaning "skillful", "deft" or "good at".

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

Early development: the bootstrap compiler (stage0) is in progress. See `docs/roadmap.md`.

## Repository layout

| Path | Contents |
|---|---|
| `stage0/` | Bootstrap compiler in TypeScript |
| `runtime/` | C runtime |
| `tests/` | Run tests: Lerta source and expected output |
| `docs/` | Documentation (see below) |

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
pnpm build
pnpm test
```
