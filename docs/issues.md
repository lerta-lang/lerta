# Issues

Known defects. Each says where it is, how to see it and how to fix it. An issue marked *unverified* was found by reading the code and has not been reproduced.

## `lerta fmt` reports two differences in one hunk under the rule of the later one

Severity: Low.

Where a hunk is not split into pairs of lines, `difference_finding` (compiler/format/format.lerta) reports only its first difference, and where no rule holds that place, under the first rule whose part starts after it in the hunk (`first_rule_from`), even if that part is another difference:

```
a := 1 +  2
xs :=
  'a'
  'b'
```

`lerta fmt` reports `1:10: write the literal in a block without brackets (Multi-line literals)` for the Spacing of line 1, and nothing for the list it joins.

Fix: split a hunk at the lines where the formatted text reaches the source again, or report each rule part that starts in the hunk at a place of its own.
