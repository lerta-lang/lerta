# Known issues

Defects of what is implemented: where the implementation departs from [the reference](reference/README.md) or [the internals](internals.md), or fails without a cause in the program. Each is removed when it is fixed. What is not implemented yet is in [the roadmap](roadmap/README.md).

Each entry says what goes wrong, a minimal program that shows it, and where the cause is. An entry marked *unconfirmed* was found by reading the code and has not been reproduced.

## Compiler

### A `const` may take the name of a builtin type

`const Int = 3` is accepted, while `class Int` is rejected as already defined, though types and values share one namespace.

### An integer literal is not a Float where a `Float?` is expected

`const e: Float? = 1` is rejected with `expected Float?, got Int`, though an integer literal is a Float where a Float is expected; so is `-0 as Float ? 1.0`. The reference does not say whether a `Float?` counts, so this may need deciding first.

### A generic interface is not checked for the member types its type arguments make

`Source<Int?>`, for an interface whose member returns `T[]`, is accepted where it is written, though an array cannot hold `Int?`; no class can satisfy it, so the error comes only where one is given for it.

## Commands and tools

- A value or a path that starts with `-` cannot be given, as any such argument is taken as a flag (`is_value` in `compiler/main.lerta`).
- `lerta build` killed while it compiles the runtime leaves its `.staging-` directory in the cache (`compiler/runtime_cache.lerta`; unconfirmed).

## Open questions

Behavior the reference leaves open, to decide before it is fixed or documented as is:

- SIGPIPE is not ignored, so `program | head -1` ends the program with status 141 instead of through the failure of stdout.
- A map stores the Float key `-0.0` as `0.0`.
- An integer literal beyond `Int` is rejected where a Float is expected.
- A list of `when` patterns cannot be broken across lines, so a long one goes past 100 columns.
