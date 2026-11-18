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

## The site renders some Markdown otherwise than GitHub, without an error

- Where: `site/markdown.lerta`, which is to fail on what it does not render: `closing_emphasis` and `closing_bracket` do not pass over a `\` escape, `emphasis` takes no run of three `*`, and `unsupported_inline` and `unsupported_block` do not name what follows.
- How to see it: `*b \* c*` gives `<em>b \</em> c*`, and `[a \] b](x)` is no link; `***x***`, `~~x~~`, a task `- [ ] x` and a bare `https://lerta.org` come out as their text, where GitHub renders them; `<!-- x -->` is shown, where GitHub hides it. None is in `docs/` so far.
- How to fix it: pass over escapes when looking for what closes, and fail on the others as on any Markdown that is not rendered.
