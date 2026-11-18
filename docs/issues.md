# Issues

Known defects. Each says where it is, how to see it and how to fix it. An issue marked *unverified* was found by reading the code and has not been reproduced.

## A heading's anchor keeps capitals and symbols that are not ASCII

- Where: `slug` in `site/markdown.lerta` lowers the ASCII letters alone and keeps every character that is not ASCII, as std tells no class of those.
- How to see it: `# Été — 🌞` gets the anchor `Été-—-🌞`, where GitHub gives `été--`, so that a link written for GitHub does not reach the heading on the site.
- How to fix it: lower the letters that are not ASCII and drop the other characters, as GitHub does, once std can tell them apart.

## A two-way value in the `then` value of another, without parentheses, is not reported

- Where: `parts_of` in `compiler/format/two_way.lerta` expects one `then` and one `else` outside brackets for each link of a chain, and the rewrite of Parentheses does not add the parentheses that [Parentheses](reference/style.md#parentheses) asks for there.
- How to see it: `lerta fmt` reports nothing for `x := a then b then c else d else e`.
- How to fix it: have the rewrite of Parentheses add them around the inner value, after which `parts_of` finds each value.

## The formatter fails on a tuple with a comment after an item's comma

- Where: the layout of a tuple in `compiler/format/`, which writes the items after such a comment so that the tuple does not close. *Unverified* where.
- How to see it: `lerta fmt` reports `its rewrites would not parse: ... expected ')', found end of line, which is a fault of the formatter` for this; an array written so is laid out, `1  # c` and `2` in a block:
  ```lerta
  x := (1, # c
    2)
  ```
- How to fix it: lay the tuple out with an item on each line, as it does the parameters of a function with such a comment.

## One `lerta fmt --fix` leaves a type that the next one leaves out

- Where: the check of the types left out, in `compiler/format/`, which keeps every type of the file when the functions of the program rewritten are not those of the file, as they are not once `(a, b) -> a.compare(b)` is left out of a `sorted`. *Unverified* that this is the cause.
- How to see it: of this file, `lerta fmt --fix` writes `xs.sorted()`, reports `leave out the type that can be inferred` and keeps `x: Int`; run again, it writes `x := 1 + 2`:
  ```lerta
  x: Int = 1 + 2
  print x
  xs := [3, 1, 2]
  print xs.sorted((a, b) -> a.compare(b))
  ```
- How to fix it: compare the types of the declarations and functions that both programs have.

## `lerta fmt --fix` leaves the CRLF line ends inside a multiline string

- Where: the layout in `compiler/format/` writes a string literal's token as it is, with the line ends inside it.
- How to see it: of a file with CRLF line ends that holds a `"""` literal of several lines, `lerta fmt --fix` writes LF after each line but those inside the literal, and then reports nothing.
- How to fix it: write the line ends inside a multiline literal as LF, which changes nothing of its value, as a CRLF there is a line feed.

## The site renders some Markdown otherwise than GitHub, without an error

- Where: `site/markdown.lerta`, which is to fail on what it does not render: `closing_emphasis` and `closing_bracket` do not pass over a `\` escape, `emphasis` takes no run of three `*`, and `unsupported_inline` and `unsupported_block` do not name what follows.
- How to see it: `*b \* c*` gives `<em>b \</em> c*`, and `[a \] b](x)` is no link; `***x***`, `~~x~~`, a task `- [ ] x` and a bare `https://lerta.org` come out as their text, where GitHub renders them; `<!-- x -->` is shown, where GitHub hides it. None is in `docs/` so far.
- How to fix it: pass over escapes when looking for what closes, and fail on the others as on any Markdown that is not rendered.
