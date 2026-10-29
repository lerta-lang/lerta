# Issues

Known defects, most severe first.

| # | Title | Severity |
|---|---|---|
| 1 | `lerta fmt` reports a removal before a trailing comment as Layout | Info |

## 1. `lerta fmt` reports a removal before a trailing comment as Layout

Where `lerta fmt` leaves out what ends a line with a comment after it, as the `= nil` of `var x: Int? = nil  # note` or the `else nil` of `x := c then 1 else nil  # note`, it reports `indent by two spaces for each level, and end the lines with LF (Layout)` at the start of what it leaves out, rather than Nil initial values or Else nil, which it reports without the comment. The comment moves on the line, and the report names the rule of that difference rather than of the removal, at least where the line is alone in the lines that change. `tests/format/nil_initial.report` records it.
