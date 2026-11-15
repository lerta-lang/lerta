# Issues

Known defects. Each says where it is, how to see it and how to fix it. An issue marked *unverified* was found by reading the code and has not been reproduced.

## A heading's anchor drops the letters that are not ASCII

- Where: `slug` in `site/markdown.lerta` keeps a character only if `Char.is_alphanumeric` holds, which is true of ASCII letters and digits alone.
- How to see it: `# Déjà vu` gets the anchor `dj-vu`, where GitHub gives `déjà-vu`, so that a link written for GitHub does not reach the heading on the site.
- How to fix it: keep the letters and digits that are not ASCII too, lowered as GitHub lowers them.

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

## A rewrite that changes the syntax tree can change the program unnoticed

- Where: the rounds of rewrites in `compiler/format/format.lerta` compare the tree of the text written with that of the edits whose rules are in `TREE_CHANGES` alone, so an edit of one of those rules is checked only in that it parses.
- How to see it: an argument block written after a callee that is a call, as `mk(a)(x, c then ... else ...)` written `mk(a)` with `x` and an `if` in a block below, parses as `mk(a, x, ...)`; the formatter wrote it so until the rewrite of long arguments learned to report such a callee.
- How to fix it: check each tree-changing rewrite against the tree that it is meant to make, as by type-checking the result or by comparing the trees outside the spans that the rewrite changes.

## An Iter comprehension with its for first is slower than one on a line

- Where: the parser makes a comprehension in parentheses with its `for` first a call of a function that yields (`prefix_iter` in `compiler/parser/compound.lerta`), while one on a line is an Iter of its own functions; the style writes one with a long part with its `for` first (see [Comprehensions](reference/style.md#comprehensions)).
- How to see it: such a comprehension takes about 1.8 times the instructions of the same one on a line; `bench/iter/main.lerta` keeps its one on a line with `# fmt: skip` for that.
- How to fix it: make the Iter of a comprehension with its `for` first as that of one on a line where its block is one value, or make a function that yields as fast.

## A comprehension with its for first keeps the spacing it is written with

- Where: the walk of `compiler/format/walk_expressions.lerta` lays out a comprehension with its `for` first as it is written, and the rewrite that writes one so (see [Comprehensions](reference/style.md#comprehensions)) takes the text of its parts as they are.
- How to see it: `lerta fmt --fix` writes `[x for x in xs  when x > n + 1]` with its `for` first as `for x in xs  when x > n + 1`, two spaces before `when` (see `tests/format/range_tests`).
- How to fix it: lay out the header and the block of a comprehension with its `for` first as those of a `for` statement.
