# Issues

Known defects. Each says where it is, how to see it and how to fix it. An issue marked *unverified* was found by reading the code and has not been reproduced.

## A long two-way value over several lines is left as it is

- Where: `parts_of` in `compiler/format/two_way.lerta` finds the parts of a two-way value only on the line where it starts.
- How to see it: `lerta fmt` reports nothing for `y := ok then xs.map((x) ->`, a body of two lines, `).to_array() else []`, and `--fix` leaves it, though its `then` value has more than two leaves (see [Branches](reference/style.md#branches)).
- How to fix it: find the parts up to the end of the statement rather than of the line, and write the value as an `if` with the lines of each part moved into its block.

## A long two-way value in an interpolation is not reported

- Where: `parts_of` in `compiler/format/two_way.lerta` finds a value by its code tokens, which an interpolation, inside a string literal's token, has none of.
- How to see it: `lerta fmt` reports nothing for `x := "v #{ok then n + n + 1 else 0}"`, though its `then` value has more than two leaves (see [Branches](reference/style.md#branches)).
- How to fix it: report it at the string literal's token, found from the position of the literal that holds the interpolation.

## A two-way value in the `then` value of another, without parentheses, is not reported

- Where: `parts_of` in `compiler/format/two_way.lerta` expects one `then` and one `else` outside brackets for each link of a chain, and the rewrite of Parentheses does not add the parentheses that [Parentheses](reference/style.md#parentheses) asks for there.
- How to see it: `lerta fmt` reports nothing for `x := a then b then c else d else e`.
- How to fix it: have the rewrite of Parentheses add them around the inner value, after which `parts_of` finds each value.

## An array before a call whose function body spans lines goes into a block

- Where: the layout of a value whose array literal a member call follows (see [Multi-line literals](reference/style.md#multi-line-literals)), in `compiler/format/lines.lerta`.
- How to see it: `lerta fmt --fix` writes `y := [1, 2].map((v) ->`, a body of several lines, `)` as `y :=`, then `1, 2` and `.map((v) ->` on lines below it, which reads as if the array were the value.
- How to fix it: keep a literal in its brackets on the line of its value where a call after it takes lines of its own.

## A rewrite that changes the syntax tree can change the program unnoticed

- Where: the rounds of rewrites in `compiler/format/format.lerta` compare the tree of the text written with that of the edits whose rules are in `TREE_CHANGES` alone, so an edit of one of those rules is checked only in that it parses.
- How to see it: an argument block written after a callee that is a call, as `mk(a)(x, c then ... else ...)` written `mk(a)` with `x` and an `if` in a block below, parses as `mk(a, x, ...)`; the formatter wrote it so until the rewrite of long arguments learned to report such a callee.
- How to fix it: check each tree-changing rewrite against the tree that it is meant to make, as by type-checking the result or by comparing the trees outside the spans that the rewrite changes.
