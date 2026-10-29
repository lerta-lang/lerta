# Issues

Known defects, most severe first.

| # | Title | Severity |
|---|---|---|
| 1 | `print_error` writes on after stderr has failed | Info |
| 2 | Output can wait behind other work on the thread pool | Info |
| 3 | The stdin thread and a child given fd 0 both read the input | Info |
| 4 | A `PipeWriter.write` cancelled after its chunk is taken throws | Info |
| 5 | `Float.to_fixed` throws for a large finite value | Info |
| 6 | std writes `else nil`, which the style leaves out | Info |
| 7 | The compiler calls `.iter()` and wraps functions in literals where neither is needed | Info |

## 1. `print_error` writes on after stderr has failed

`print_error` in `runtime/io.c` writes to stderr without looking at whether stderr has failed, while `print` in `runtime/output.c` drops its output after a failure, as `docs/reference/modules.md` says. A failure by `EPIPE` ends the program by `SIGPIPE`, so only a failure such as `EBADF` shows this. This is found by reading the code.

The fix is for `print_error` to write through `lerta_output_write_now` as `print` does.

## 2. Output can wait behind other work on the thread pool

`wait_in_flight` in `runtime/output.c` waits for a write queued on the libuv thread pool. When long file operations, such as `read_file` on a FIFO, hold every thread of the pool, `print` and the exit wait for them, and a panic spins. This is found by reading the code.

## 3. The stdin thread and a child given fd 0 both read the input

While the thread in `runtime/stdin.c` waits in `read(0)`, a child started by `run` that inherits fd 0 reads from the same input, and each takes part of it. The docs do not say so. This is found by reading the code.

## 4. A `PipeWriter.write` cancelled after its chunk is taken throws

When a cancel comes right after the reader takes the chunk of `PipeWriter.write` in `std/io.lerta`, the data is delivered and the write still throws `CancelledError`. `docs/reference/modules.md` says only that a write cancelled before its chunk is taken writes nothing. This is found by reading the code.

## 5. `Float.to_fixed` throws for a large finite value

`to_fixed` in `std/builtins/numbers.lerta` rounds the value times 10 to the `digits` as an `Int`, so `1e20.to_fixed(0)` throws `integer overflow`. `docs/reference/types.md` says so, but a formatting function that fails on a finite value is a surprise.

The fix is to format a value whose product does not fit an `Int` another way, as C's `%.*f` does.

## 6. std writes `else nil`, which the style leaves out

`std/http.lerta` and `std/internal/http_client.lerta` write `c then x else nil` in several places, as `chunked then ChunkedBody(...) else nil`, where `docs/reference/style.md` says to leave out `else nil`. `lerta fmt` has no rule for it.

The fix is a rule in `lerta fmt` that drops the `else nil` of a `then`, which then rewrites std.

## 7. The compiler calls `.iter()` and wraps functions in literals where neither is needed

`compiler/runtime_cache.lerta` writes `files.iter().all((file) -> is_file(file))` and `files.iter().any(...)` where `files.all(is_file)` works, as an array is an `Iterable`; `compiler/libuv.lerta` calls `parts.iter().any(...)` too.

The fix is to drop the `.iter()` and pass `is_file` itself.
