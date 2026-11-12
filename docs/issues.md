# Issues

Known defects. Each says where it is, how to see it and how to fix it. An issue marked *unverified* was found by reading the code and has not been reproduced.

## An array cannot hold optional interface values

`check_item_type` (`compiler/checker/collection.lerta`) rejects arrays of optional interface values, as the generated code would hold them as optional values that are not references (`is_optional_value` in `compiler/codegen/array.lerta`), whose `{ i1, T }` an interface value's two pointers are not. `xs: Named?[] = [nil]`, with `interface Named` of a field `name: String`, fails with `an array cannot hold values of type Named?`. Fix: hold them as interface items, a null data pointer for nil, and drop the limitation in [optional values](reference/types.md#optional-values).

## lerta_program_path is apart from lerta_argv

`lerta_argv` (`runtime/process.c`) gives the arguments without the program's path, and `lerta_program_path` gives the path, which std:process's `program` reads. One function could give both, the path first, but `lerta_argv` cannot change before a seed refresh, as the seed is compiled from a std that takes its result for the arguments alone: the seed's minilerta would take its own path for its first argument. Fix: once the seed is refreshed, have `lerta_argv` give the path first, have std:process take `argv` and `program` from it, and remove `lerta_program_path` from `runtime/process.c` and `runtime/lerta.h`.

## The compiler does not carry the license notices

[Cache](reference/compiler.md#cache) says that an executable given to others goes with Lerta's license notice and libuv's, but the compiler holds neither text: `build/embedded.lerta` (see [embedded files](internals/architecture.md#embedded-files)) embeds only `std/`, `runtime/` and libuv's sources. One who has only the compiler, as from a binary release, has no copy of `LICENSE-MIT`, `LICENSE-APACHE` or `third_party/libuv/LICENSE` to give. Fix: embed them and add a command that writes them out.

## Comments in tests/ name test/cli.lerta for checks that moved to test/cli/

The checks of the CLI suite are in `test/cli/*.lerta`, which `test/cli.lerta` gathers, but comments of the files they run still say that `test/cli.lerta` runs or links them, as `tests/extern/lib/leak.c`, `tests/extern/lib/sized.c` and `tests/extern/lib/leak.lerta` (`test/cli/extern.lerta`), `tests/leak/lib/*.lerta`, `tests/bin/echo_stdin.lerta`, `tests/bin/read_after_cancel.lerta` and `tests/cli/status.txt`. Fix: name the file under `test/cli/` that holds each check.

## The main run loop stays off for CoreFoundation loaded after the first wait

`uses_run_loop` (`runtime/loop.c`) looks for CoreFoundation once, at the program's first wait (see [the main run loop](internals/iteration.md#the-main-run-loop)). A program that waits, then loads a framework with `dlopen` and has it post a block to the main dispatch queue, never runs the block. Fix: look again at later waits while it is not found, if that costs a waiting program little.

## fmt does not break a long line of union members below =

`lerta fmt` keeps each line of a union written on the lines below `=` (see `union_lines` in `compiler/format/walk_statements.lerta`), and reports one over 100 columns as too long to break, though the parser takes the members on any lines. Fix: start a line before the first member that does not fit on its line.
