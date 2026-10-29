# Issues

Known defects, most severe first.

| # | Title | Severity |
|---|---|---|
| 1 | std writes `else nil`, which the style leaves out | Info |

## 1. std writes `else nil`, which the style leaves out

`std/http.lerta` and `std/internal/http_client.lerta` write `c then x else nil` in several places, as `chunked then ChunkedBody(...) else nil`, where `docs/reference/style.md` says to leave out `else nil`. `lerta fmt` has no rule for it.

The fix is a rule in `lerta fmt` that drops the `else nil` of a `then`, which then rewrites std.
