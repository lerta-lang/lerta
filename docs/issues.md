# Issues

Known defects. Each says where it is, how to see it and how to fix it. An issue marked *unverified* was found by reading the code and has not been reproduced.

## `lerta fmt` reports a list it would join under the rule of another place

Severity: Low.

A literal written on lines of its own that fits on one line is reported where it starts, but under the name and the message of a rule that some other place in the file breaks, or of Layout when none does:

```
xs :=
  'a'
  'b'
print "c"
```

`lerta fmt` reports ``1:6: call without parentheses at the start of a statement, with them after `then` or `->` (Calls without parentheses)``; without the last line, `1:6: indent by two spaces for each level, and end the lines with LF (Layout)`. `lerta fmt --fix` joins the list as expected.

Fix: name the rule of the place reported, here Multi-line literals.

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
