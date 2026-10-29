# Issues

Known defects, most severe first.

| # | Title | Severity |
|---|---|---|
| 1 | `lerta fmt` breaks a multi-line `case` inside an index | Low |

## 1. `lerta fmt` breaks a multi-line `case` inside an index

An index whose position is a `case` on lines of its own compiles and runs, but `lerta fmt` prints it as code that does not parse, and reports that instead of formatting the file:

```
print boxes[
  case
    when replacing
      boxes = [Box('second')]
      0
    else 0
].name
```

`lerta fmt` reports `expected end of line, found ']'`. `tests/call/borrowed_values.lerta` keeps such an index with `# fmt: skip`.
