# Issues

Known defects, most severe first.

| # | Title | Severity |
|---|---|---|
| 1 | `read_console` underflows when given fewer than 3 bytes | Info |
| 2 | `read_console` loops when the input ends after a held high surrogate | Info |

## 1. `read_console` underflows when given fewer than 3 bytes

In `runtime/platform_windows.c`, `read_console` reads `size / 3` UTF-16 units. With `size` below 3 and a high surrogate held from the last read, `fitting - start` is -1, and `ReadConsoleW` is asked for about 4 billion units into an 8192-unit buffer. `lerta_stdin_read` always passes 65536, so this cannot happen today.

The fix is to read at least one unit beyond the held surrogate.

## 2. `read_console` loops when the input ends after a held high surrogate

In `runtime/platform_windows.c`, when `read_console` holds a high surrogate and `ReadConsoleW` then reads nothing, the check for the end sees the held unit, holds it again and reads again, without end. The check for Ctrl-Z also looks at `wide[0]`, the held unit, in place of `wide[start]`. This is found by reading the code, not by running it.

The fix is to end when nothing is read, and to look at `wide[start]` for Ctrl-Z.
