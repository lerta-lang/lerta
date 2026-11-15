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

- Where: the rounds of rewrites in `compiler/format/format.lerta` compare the tree of the text written with that of the edits whose rules are in `TREE_CHANGES` alone, and check that a program that checked still does, so an edit of one of those rules that gives another program that checks goes unnoticed.
- How to see it: a rewrite that wrote `a - b` for `b - a` of two numbers would be applied without a report; `tests/format/rewritten_forms.lerta` checks the forms that each rewrite writes instead.
- How to fix it: check each tree-changing rewrite against the tree that it is meant to make, as by comparing the trees outside the spans that the rewrite changes, which the nodes, holding only where they start, cannot tell yet.

## A called function literal that infers its parameters ignores the type expected of its result

- Where: `type_of_literal_call` in `compiler/checker/expression.lerta` types the arguments of a function literal called where it is written without the type expected of the call.
- How to see it: `x: Float = ((n) -> n)(1)` reports `expected Float, got Int`, where `x: Float = 1` checks.
- How to fix it: pass the type expected to the literal as its result, and through it to the arguments that its parameters return.

## A comprehension with its for first keeps the spacing it is written with

- Where: the walk of `compiler/format/walk_expressions.lerta` lays out a comprehension with its `for` first as it is written, and the rewrite that writes one so (see [Comprehensions](reference/style.md#comprehensions)) takes the text of its parts as they are.
- How to see it: `lerta fmt --fix` writes `[x for x in xs  when x > n + 1]` with its `for` first as `for x in xs  when x > n + 1`, two spaces before `when` (see `tests/format/range_tests`).
- How to fix it: lay out the header and the block of a comprehension with its `for` first as those of a `for` statement.
