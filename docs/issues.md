# Issues

Known defects, most severe first.

| # | Title | Severity |
|---|---|---|
| 1 | A Reader refuses a read right after `timeout` ends the last one | Low |
| 2 | `Reader.read` returns an empty Binary at the end after an empty chunk | Low |
| 3 | `read_console` underflows when given fewer than 3 bytes | Info |
| 4 | `read_console` loops when the input ends after a held high surrogate | Info |

## 1. A Reader refuses a read right after `timeout` ends the last one

`first_settled` in `std/async.lerta` cancels the losing Promises and returns without waiting for them to unwind. A read that `timeout` ends has not yet left `Reader.exclusive` in `std/io.lerta`, so a read started right after the `TimeoutError` throws `a Reader is read by another read that has not ended`. After one `await`, it succeeds. std:http awaits a write in between, so it is not affected.

The fix is for `first_settled` to await the cancelled Promises before it returns, though a step that a cancel does not stop, such as a write in progress, then delays the `TimeoutError`.

## 2. `Reader.read` returns an empty Binary at the end after an empty chunk

`fill` in `std/io.lerta` takes an empty chunk as data, so when a `read_chunk` returns an empty Binary and then nil, `read` returns an empty Binary in place of nil. The runtime never gives an empty chunk, so only a `read_chunk` of the program's own does this.

The fix is for `fill` to skip an empty chunk.

## 3. `read_console` underflows when given fewer than 3 bytes

In `runtime/platform_windows.c`, `read_console` reads `size / 3` UTF-16 units. With `size` below 3 and a high surrogate held from the last read, `fitting - start` is -1, and `ReadConsoleW` is asked for about 4 billion units into an 8192-unit buffer. `lerta_stdin_read` always passes 65536, so this cannot happen today.

The fix is to read at least one unit beyond the held surrogate.

## 4. `read_console` loops when the input ends after a held high surrogate

In `runtime/platform_windows.c`, when `read_console` holds a high surrogate and `ReadConsoleW` then reads nothing, the check for the end sees the held unit, holds it again and reads again, without end. The check for Ctrl-Z also looks at `wide[0]`, the held unit, in place of `wide[start]`. This is found by reading the code, not by running it.

The fix is to end when nothing is read, and to look at `wide[start]` for Ctrl-Z.
