# Issues

Known defects, most severe first.

| # | Title | Severity |
|---|---|---|
| 1 | A chunk size line takes spaces and a stray CR | Low |
| 2 | The HTTP client refuses a folded header line | Low |
| 3 | A POST from curl waits a second for `100 Continue` | Low |
| 4 | `stdout.write` fails for good after `run` is given `stdout` | Low |
| 5 | `print_error` writes on after stderr has failed | Info |
| 6 | Output can wait behind other work on the thread pool | Info |
| 7 | The stdin thread and a child given fd 0 both read the input | Info |
| 8 | A `PipeWriter.write` cancelled after its chunk is taken throws | Info |

## 1. A chunk size line takes spaces and a stray CR

The chunk size in `std/internal/http_chunks.lerta` is trimmed, so ` 3\r\n` and `3\r\r\n` are taken as 3. `docs/reference/modules.md` calls a size that is not hexadecimal malformed, and RFC 9112 allows only hex digits. A server and a proxy that read the size differently can be made to split requests differently.

The fix is to take the size only when it is one or more hex digits.

## 2. The HTTP client refuses a folded header line

The HTTP client in `std/internal/http_client.lerta` takes a header line that starts with a space or tab as a malformed response. RFC 9112 asks a user agent to replace the fold with a space; a server may refuse it, as std:http does. `docs/reference/modules.md` says the client refuses it, so this is a choice to make, not a mismatch.

## 3. A POST from curl waits a second for `100 Continue`

std:http does not answer `Expect: 100-continue`, so curl waits about a second before it sends a body: a POST of 2 MB takes 1.03 s, and 0.008 s with `-H 'Expect:'`. `docs/roadmap/programs.md` plans the answer.

## 4. `stdout.write` fails for good after `run` is given `stdout`

`run(command, stdout: stdout)` ends its writers when the child ends, and `StandardOutput.end` in `std/io.lerta` ends `stdout`, so a later `stdout.write` throws `cannot write to stdout`; `print` still works. `docs/reference/modules.md` describes this, but it is the plainest way to pass `stdout` as a Writer.

The fix is to keep `stdout` and `stderr` open when `run` ends its writers, or to say so in the docs of std:io and std:process.

## 5. `print_error` writes on after stderr has failed

`print_error` in `runtime/io.c` writes to stderr without looking at whether stderr has failed, while `print` in `runtime/output.c` drops its output after a failure, as `docs/reference/modules.md` says. A failure by `EPIPE` ends the program by `SIGPIPE`, so only a failure such as `EBADF` shows this. This is found by reading the code.

The fix is for `print_error` to write through `lerta_output_write_now` as `print` does.

## 6. Output can wait behind other work on the thread pool

`wait_in_flight` in `runtime/output.c` waits for a write queued on the libuv thread pool. When long file operations, such as `read_file` on a FIFO, hold every thread of the pool, `print` and the exit wait for them, and a panic spins. This is found by reading the code.

## 7. The stdin thread and a child given fd 0 both read the input

While the thread in `runtime/stdin.c` waits in `read(0)`, a child started by `run` that inherits fd 0 reads from the same input, and each takes part of it. The docs do not say so. This is found by reading the code.

## 8. A `PipeWriter.write` cancelled after its chunk is taken throws

When a cancel comes right after the reader takes the chunk of `PipeWriter.write` in `std/io.lerta`, the data is delivered and the write still throws `CancelledError`. `docs/reference/modules.md` says only that a write cancelled before its chunk is taken writes nothing. This is found by reading the code.
