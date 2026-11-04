# Issues

Known defects. Each says where it is, how to see it and how to fix it. An issue marked *unverified* was found by reading the code and has not been reproduced.

## `lerta fmt` reports a line whose indentation and spaces differ under Spacing at its indentation

Severity: Low.

Where a line that pairs with a formatted one differs in its indentation and in the spaces within it, `kind_of_difference` (compiler/format/format.lerta) names Spacing, at the first difference, which is in the indentation:

```
if true
    b := 1 +  2
```

`lerta fmt` reports `2:3: put one space here, or none (Spacing)`.

Fix: name Layout where the indentation differs, or report the Spacing at the first difference past the indentation.
