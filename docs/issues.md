# Issues

Known defects. Each says where it is, how to see it and how to fix it. An issue marked *unverified* was found by reading the code and has not been reproduced.

## A heading's anchor keeps capitals and symbols that are not ASCII

- Where: `slug` in `site/markdown.lerta` lowers the ASCII letters alone and keeps every character that is not ASCII, as std tells no class of those.
- How to see it: `# Été — 🌞` gets the anchor `Été-—-🌞`, where GitHub gives `été--`, so that a link written for GitHub does not reach the heading on the site.
- How to fix it: lower the letters that are not ASCII and drop the other characters, as GitHub does, once std can tell them apart.

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
