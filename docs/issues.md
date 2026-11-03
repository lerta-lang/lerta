# Issues

Known defects. Each says where it is, how to see it and how to fix it. An issue marked *unverified* was found by reading the code and has not been reproduced.

## `lerta fmt` fails on a comment before an operand in parentheses

Severity: Low.

A comment on a line of its own before an operand that starts with `(` but is not a function literal makes the formatter fail, in two places at least:

```
x :=
  # c
  (1 + 2) * 3
f := ->
  print(
    # c
    (1 + 2) * 3
  )
```

`lerta fmt` reports `the formatter would write a program that does not parse, which is a bug` for the first, and `the formatter would change the program, which is a bug` for the second, where the call is rewritten without parentheses. In an array, or as the argument of a call that is not a statement, the comment is placed.

Fix: place the comment before the `(`, or report it as stranded, as one before the parameters of a function literal is (see stranded_comments in compiler/format/source.lerta).

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
