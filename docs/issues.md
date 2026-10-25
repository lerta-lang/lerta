# Issues

Known defects found by a security review, most severe first.

| # | Title | Severity |
|---|---|---|
| 1 | `decode_json` crashes on deeply nested input | Medium |
| 2 | std:http accepts control characters in a field value | Low |
| 3 | The compiler crashes on deeply nested source | Low |
| 4 | `read_console` underflows when given fewer than 3 bytes | Info |

## 1. `decode_json` crashes on deeply nested input

`skip_value` in `std/internal/json_reader.lerta` and the read functions that `compiler/codegen/json_read.lerta` generates recurse for each nested array or object, with no limit on the depth. Nesting 100,000 deep, such as `[[[…]]]` as the value of a key the target struct does not have, overflows the stack and aborts the program with exit status 134. A server that decodes JSON from a client can be stopped by one request.

The fix is a limit on the depth, beyond which the reader throws a `JsonError`.

## 2. std:http accepts control characters in a field value

`check_field` in `std/http.lerta` rejects only CR, LF and NUL in a field value. A request's `X-Echo: v\x0bx` reaches the handler, and a handler that copies it into a response sends it on. Without CR or LF it cannot split the response, but RFC 9110 does not allow it, and an intermediary may read it differently.

The fix is to allow only visible ASCII, horizontal tab and bytes from 0x80 to 0xFF.

## 3. The compiler crashes on deeply nested source

The recursive descent parser has no limit on nesting. Source with 200,000 nested parentheses or array literals makes `lerta dump-ast` abort with exit status 134 on a stack overflow. `lerta lsp` parses what an editor opens, so a file can stop the language server.

The fix is a limit on the depth, beyond which the parser reports a compile error.

## 4. `read_console` underflows when given fewer than 3 bytes

In `runtime/platform_windows.c`, `read_console` reads `size / 3` UTF-16 units. With `size` below 3 and a high surrogate held from the last read, `fitting - start` is -1, and `ReadConsoleW` is asked for about 4 billion units into an 8192-unit buffer. `lerta_stdin_read` always passes 65536, so this cannot happen today.

The fix is to read at least one unit beyond the held surrogate.
