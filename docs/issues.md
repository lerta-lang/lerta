# Issues

Known defects, most severe first.

| # | Title | Severity |
|---|---|---|
| 1 | std:http accepts control characters in a field value | Low |
| 2 | The compiler crashes on deeply nested source | Low |
| 3 | std:http repeats Content-Length and Connection that a handler puts in `fields` | Low |
| 4 | A Reader refuses a read right after `timeout` ends the last one | Low |
| 5 | `Reader.read` returns an empty Binary at the end after an empty chunk | Low |
| 6 | `while` does not narrow in its body | Info |
| 7 | Testing a weak local for nil does not say why it is not narrowed | Info |
| 8 | The reference says an enum cannot be a member of a union | Info |
| 9 | `LertaPrefix` is aligned to 16 but placed at 8 | Info |
| 10 | `read_console` underflows when given fewer than 3 bytes | Info |
| 11 | `read_console` loops when the input ends after a held high surrogate | Info |

## 1. std:http accepts control characters in a field value

`check_field` in `std/http.lerta` rejects only CR, LF and NUL in a field value. A request's `X-Echo: v\x0bx` reaches the handler, and a handler that copies it into a response sends it on. Without CR or LF it cannot split the response, but RFC 9110 does not allow it, and an intermediary may read it differently.

The fix is to allow only visible ASCII, horizontal tab and bytes from 0x80 to 0xFF.

## 2. The compiler crashes on deeply nested source

The recursive descent parser has no limit on nesting. Source with 200,000 nested parentheses or array literals makes `lerta dump-ast` abort with exit status 134 on a stack overflow. `lerta lsp` parses what an editor opens, so a file can stop the language server.

The fix is a limit on the depth, beyond which the parser reports a compile error.

## 3. std:http repeats Content-Length and Connection that a handler puts in `fields`

`response_bytes` in `std/http.lerta` drops the framing fields a handler gives by comparing their names with lowercase ones. A handler that pushes `('Content-Length', '99')` to `fields` directly gets it sent beside the server's `content-length: 3`, and the response's framing breaks.

The fix is to compare the names in lowercase.

## 4. A Reader refuses a read right after `timeout` ends the last one

`first_settled` in `std/async.lerta` cancels the losing Promises and returns without waiting for them to unwind. A read that `timeout` ends has not yet left `Reader.exclusive` in `std/io.lerta`, so a read started right after the `TimeoutError` throws `a Reader is read by another read that has not ended`. After one `await`, it succeeds. std:http awaits a write in between, so it is not affected.

The fix is for `first_settled` to await the cancelled Promises before it returns, though a step that a cancel does not stop, such as a write in progress, then delays the `TimeoutError`.

## 5. `Reader.read` returns an empty Binary at the end after an empty chunk

`fill` in `std/io.lerta` takes an empty chunk as data, so when a `read_chunk` returns an empty Binary and then nil, `read` returns an empty Binary in place of nil. The runtime never gives an empty chunk, so only a `read_chunk` of the program's own does this.

The fix is for `fill` to skip an empty chunk.

## 6. `while` does not narrow in its body

`check_while` in `compiler/checker/loop.lerta` checks the condition but does not narrow by it, so `while m != nil` followed by `m.v` is rejected with `type Node? has no property 'v'`. [The reference](reference/control-flow.md) does not list `while` among the places that narrow.

The fix is to narrow the body by the condition, as `if` does, and to add `while` to the reference.

## 7. Testing a weak local for nil does not say why it is not narrowed

A weak local is not narrowed, as the reference says, but after `if w != nil`, `w.n` reports only `type C? has no property 'n'`.

The fix is to add that `w` is weak and can be taken with `if alive := w`.

## 8. The reference says an enum cannot be a member of a union

[The reference](reference/types.md) says an enum cannot be a member of a union so far, but the checker accepts `type K = Color | Int`, and `case` and `to_string` work on it.

The fix is to remove the sentence.

## 9. `LertaPrefix` is aligned to 16 but placed at 8

In the debug runtime, `LertaPrefix` in `runtime/internal.h` is declared `_Alignas(16)`, but the allocator places objects at multiples of 8, so half of the prefixes are not aligned to 16. A compiler may use aligned 16-byte instructions on them; clang 21 on x86-64 does not today.

The fix is to align it to 8.

## 10. `read_console` underflows when given fewer than 3 bytes

In `runtime/platform_windows.c`, `read_console` reads `size / 3` UTF-16 units. With `size` below 3 and a high surrogate held from the last read, `fitting - start` is -1, and `ReadConsoleW` is asked for about 4 billion units into an 8192-unit buffer. `lerta_stdin_read` always passes 65536, so this cannot happen today.

The fix is to read at least one unit beyond the held surrogate.

## 11. `read_console` loops when the input ends after a held high surrogate

In `runtime/platform_windows.c`, when `read_console` holds a high surrogate and `ReadConsoleW` then reads nothing, the check for the end sees the held unit, holds it again and reads again, without end. The check for Ctrl-Z also looks at `wide[0]`, the held unit, in place of `wide[start]`. This is found by reading the code, not by running it.

The fix is to end when nothing is read, and to look at `wide[start]` for Ctrl-Z.
