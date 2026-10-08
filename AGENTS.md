# AGENTS.md

Instructions for coding agents working in this repository. For the project overview, status and layout, see `README.md`.

Read these before changing behavior:

- `docs/roadmap.md`: the self-hosting subset. Do not implement features outside it without asking.
- `docs/philosophy.md`: the design principles. When a design question is not covered, apply them in priority order.
- `docs/design/`: the planned language design. Implement features as specified there.
- `docs/reference/`: the language as implemented so far, including the coding conventions for Lerta code.
- `docs/internals.md`: the implementation design, including the constraints on the C runtime.

## Workflow

1. **Plan first.** Before implementing, explain the approach and get the user's agreement.
2. **Implement with tests.** Every language feature gets run tests in `tests/`: a Lerta source file plus its expected output (the expected files are described at the top of `test/run.ts`). Programs in `examples/` are run as tests too; their expected output goes in `tests/examples/`.
3. **Review.** After implementing, run an adversarial review with a subagent that follows `.agents/reviewer.md`.
   - Run `make test`, and `pnpm check` in `test/`, yourself before each review; the reviewer does not.
   - Show the reviewer only the code and the tests. Do not pass the intent, the background or your design decisions.
   - Fix the findings and send the result back to **the same reviewer** for re-review. Repeat until no findings remain.
4. **Update the docs.** When a feature is implemented, move its description from `docs/design/` to `docs/reference/` as described in `docs/design/README.md`.
5. **Commit only with approval.** Show the change to the user and get approval before committing.
6. **Consider refactoring.** Look at the functions, classes, files and directories the change touched. If any has grown long through repeated additions, consider whether it should be split or restructured. If it should, propose the refactoring to the user as the next task; do not mix it into the current change.

## Coding style

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

Follow the self-hosting subset and the runtime rules in `docs/roadmap.md` and `docs/internals.md`.
