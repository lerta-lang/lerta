# Issues

Known defects, most severe first.

| # | Title | Severity |
|---|---|---|
| 1 | A `PipeWriter.write` cancelled after its chunk is taken throws | Info |
| 2 | `Float.to_fixed` throws for a large finite value | Info |
| 3 | std writes `else nil`, which the style leaves out | Info |
| 4 | The compiler calls `.iter()` and wraps functions in literals where neither is needed | Info |

## 1. A `PipeWriter.write` cancelled after its chunk is taken throws

When a cancel comes right after the reader takes the chunk of `PipeWriter.write` in `std/io.lerta`, the data is delivered and the write still throws `CancelledError`. `docs/reference/modules.md` says only that a write cancelled before its chunk is taken writes nothing. This is found by reading the code.

## 2. `Float.to_fixed` throws for a large finite value

`to_fixed` in `std/builtins/numbers.lerta` rounds the value times 10 to the `digits` as an `Int`, so `1e20.to_fixed(0)` throws `integer overflow`. `docs/reference/types.md` says so, but a formatting function that fails on a finite value is a surprise.

The fix is to format a value whose product does not fit an `Int` another way, as C's `%.*f` does.

## 3. std writes `else nil`, which the style leaves out

`std/http.lerta` and `std/internal/http_client.lerta` write `c then x else nil` in several places, as `chunked then ChunkedBody(...) else nil`, where `docs/reference/style.md` says to leave out `else nil`. `lerta fmt` has no rule for it.

The fix is a rule in `lerta fmt` that drops the `else nil` of a `then`, which then rewrites std.

## 4. The compiler calls `.iter()` and wraps functions in literals where neither is needed

`compiler/runtime_cache.lerta` writes `files.iter().all((file) -> is_file(file))` and `files.iter().any(...)` where `files.all(is_file)` works, as an array is an `Iterable`; `compiler/libuv.lerta` calls `parts.iter().any(...)` too.

The fix is to drop the `.iter()` and pass `is_file` itself.
