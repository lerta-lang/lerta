# Issues

Known defects. Each says where it is, how to see it and how to fix it. An issue marked *unverified* was found by reading the code and has not been reproduced.

## `lerta fmt` is quadratic in the length of an `else if` chain

Severity: Low.

`if_doc` (compiler/format/print_control.lerta:67-80) recurses per arm, and `statement_if_postfix` calls `block_has_comments` (compiler/format/source.lerta:38-63), which scans to the end of the whole chain, at every level. A chain of 2,000 arms formats in 0.6 s, 5,000 in 5 s, 10,000 in 23 s; 5,000 separate `if`s take 0.2 s.

Fix: compute the comment lines of each block once, such as a sorted array of comment lines and a table of block ends per indent.

## The array literal spread in another does not take the expected item type

Severity: Low.

A spread `xs...` is the comprehension `[x for x in xs]` marked to give its items in its place (`is_spread` in compiler/ast.lerta), and an array literal checks it with the array of its own item type expected (`expect_element` in compiler/checker/collection.lerta). The comprehension does not pass that type on to an array literal that it goes through, which is typed alone, so literals in it do not take a type from the context.

```
xs: Int8[] = [[1, 2]..., 3]
```

reports `1:15: expected Int8, got Int`, where `[1, 2, 3]` is an `Int8[]`. So does `n in [[1, 2]..., 3]` of an `Int8` `n`. The comprehension of a spread should check an array literal that it goes through with the array of the expected item type expected.

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
