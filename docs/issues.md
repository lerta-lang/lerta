# Issues

Known defects. Each says where it is, how to see it and how to fix it. An issue marked *unverified* was found by reading the code and has not been reproduced.

## `encode_json` is quadratic in the depth of a self-referential structure

Severity: Low.

`enter` (std/internal/json_writer.lerta:55-60) searches `@entered` linearly and builds the whole path text for every object entered. Encoding a chain of `class Node` with `next: Node?` takes 2 s for 10,000 nodes, 7.8 s for 20,000 and 31 s for 40,000.

Fix: keep `entered` as a `Set<Int>`, and build the path text only when a cycle is found.

## Parsing a long call without parentheses is quadratic

Severity: Low.

`command_callee_length` (compiler/parser/statement.lerta:357-368) calls `peek_at(length)` for a growing `length`, and `index_at` (compiler/parser/token_stream.lerta:75-78) walks `offset` steps each time. A callee of 60,000 members on one line takes 17 s to parse, one of 100,000 takes 48 s.

Fix: scan with a local index and `index_after`, as `closing_offset` does.

## `lerta fmt` is quadratic in the length of an `else if` chain

Severity: Low.

`if_doc` (compiler/format/print_control.lerta:67-80) recurses per arm, and `statement_if_postfix` calls `block_has_comments` (compiler/format/source.lerta:38-63), which scans to the end of the whole chain, at every level. A chain of 2,000 arms formats in 0.6 s, 5,000 in 5 s, 10,000 in 23 s; 5,000 separate `if`s take 0.2 s.

Fix: compute the comment lines of each block once, such as a sorted array of comment lines and a table of block ends per indent.

## The array literal spread in another does not take the expected item type

Severity: Low.

A spread `xs...` is the comprehension `[x for x in xs]` marked to give its items in its place (`is_spread` in compiler/ast.lerta), and an array literal checks it with the array of its own item type expected (`expect_element` in compiler/checker/collection.lerta). The comprehension does not pass that type on to an array literal that it goes through, which is typed alone, so literals in it do not take a type from the context.

```
xs: Int8[] = [[1, 2]..., 3]
```

reports `1:15: expected Int8, got Int`, where `[1, 2, 3]` is an `Int8[]`. So does `n in [[1, 2]..., 3]` of an `Int8` `n`. The comprehension of a spread should check an array literal that it goes through with the array of the expected item type expected.

## `lerta fmt` fails on a comment before an operand in parentheses

Severity: Low.

A comment on a line of its own before an operand that starts with `(` but is not a function literal makes the formatter fail, in two places at least:

```
x :=
  # c
  (1 + 2) * 3
f := ->
  print(
    # c
    (1 + 2) * 3
  )
```

`lerta fmt` reports `the formatter would write a program that does not parse, which is a bug` for the first, and `the formatter would change the program, which is a bug` for the second, where the call is rewritten without parentheses. In an array, or as the argument of a call that is not a statement, the comment is placed.

Fix: place the comment before the `(`, or report it as stranded, as one before the parameters of a function literal is (see stranded_comments in compiler/format/source.lerta).

## `lerta fmt` reports a list it would join under the rule of another place

Severity: Low.

A literal written on lines of its own that fits on one line is reported where it starts, but under the name and the message of a rule that some other place in the file breaks, or of Layout when none does:

```
xs :=
  'a'
  'b'
print "c"
```

`lerta fmt` reports ``1:6: call without parentheses at the start of a statement, with them after `then` or `->` (Calls without parentheses)``; without the last line, `1:6: indent by two spaces for each level, and end the lines with LF (Layout)`. `lerta fmt --fix` joins the list as expected.

Fix: name the rule of the place reported, here Multi-line literals.

## The test driver leaves its work directory when a module's top level throws

Severity: Low.

`work_root := make_temp_dir()` runs when test/lib/lerta.lerta is imported (:32), and test/lib/cli.lerta runs clang at import (:39-41) and reads a file (:46). The only `remove_work_root` is the `finally` around `main()` in test/main.lerta:152-157, so an exception at import leaves the directory. `TMPDIR=<empty dir> PATH=/nonexistent bin/test --list` prints `cannot run: clang`, exits 1 and leaves `<empty dir>/lerta-XXXXXX/{cache,run}`.

Fix: compute the clang probe and the hello output on first use, or make `work_root` on first use in `suite_dir`.

## The cli, format, leaks and self suites run the compiler without a timeout

Severity: Low.

`run_command` (test/lib/cli.lerta:26-36), `run_file` (test/lib/lerta.lerta:57-66), test/format.lerta:16, test/leaks.lerta:43-44 and test/self.lerta:44-55 await `run(...)` with no `timeout`, while test/run.lerta:252 and the runtime suite have one. A compiler that hangs, such as `lerta lsp` not exiting or a looping formatter, blocks a worker, and with all workers blocked `make test` never ends. *Unverified* by running.

Fix: wrap them in `timeout(..., N)` as `run_program` does, throwing `SetupError`.

## `expect_unchanged` in the format suite compares modification times written moments apart

Severity: Low.

test/format.lerta:64-67, used at :237-247, writes files, runs `fmt --fix` at once and takes `stat(path).modified_time == time` as proof that the files were not rewritten. On a filesystem with one-second timestamps a rewrite within the same second passes. APFS and ext4 have nanosecond timestamps, so the check works there.

Fix: compare the inode or change time as well, or set the modification time back to a known value before running `fmt`.

## The benchmarks and the test reports measure with `time()` instead of `monotonic()`

Severity: Low.

`measure` of bench/run.lerta and test/lib/report.lerta:77 take durations from `time()`, which [std](reference/std.md) says may go back when the clock is set back, and provides `monotonic()` for. A clock step during `make bench` gives a wrong or negative sample, which `best` takes as the minimum, and a negative product can make the geometric mean throw. *Unverified*: it takes a clock step during a run.

Fix: use `monotonic()` in both.
