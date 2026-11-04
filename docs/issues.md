# Issues

Known defects. Each says where it is, how to see it and how to fix it. An issue marked *unverified* was found by reading the code and has not been reproduced.

## An array literal does not take its item type from an optional array expected

Severity: Low.

`type_of_array` (compiler/checker/collection.lerta) takes the item type only from an expected `ArrayType`, not from an `OptionalType` of one, so

```
a: Byte[]? = [1, 2]
```

reports `1:14: expected Byte[]?, got Int[]`, where `a: Byte[] = [1, 2]` is taken.

Fix: take the expected type of the array from inside an optional, as `inner_of_expected` does for other literals.

## `in` of an optional item and array literals fails

Severity: Low.

`expected_container` (compiler/checker/operator.lerta) expects the array literal after `in` to hold the item's type without nil, but the item is then passed as it is to `contains`, which takes that type, so

```
w: Int8? = 1
print w in [1]
```

reports `2:7: expected Int8, got Int8?`.

Fix: either test a nil item as not in the array, or reject an optional item with a message that says so.

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
