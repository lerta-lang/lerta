# Issues

Known defects. Each says where it is, how to see it and how to fix it. An issue marked *unverified* was found by reading the code and has not been reproduced.

## A heading's anchor keeps capitals and symbols that are not ASCII

- Where: `slug` in `site/markdown.lerta` lowers the ASCII letters alone and keeps every character that is not ASCII, as std tells no class of those.
- How to see it: `# Été — 🌞` gets the anchor `Été-—-🌞`, where GitHub gives `été--`, so that a link written for GitHub does not reach the heading on the site.
- How to fix it: lower the letters that are not ASCII and drop the other characters, as GitHub does, once std can tell them apart.

## The site renders emphasis closed by a longer run of `*` as its text

- Where: `closing_emphasis` in `site/markdown.lerta` closes emphasis only at a run of as many `*` as open it.
- How to see it: `**x***` and `a *b***` come out as their text, without an error, where GitHub renders `<strong>x</strong>*` and `a <em>b</em>**`.
- How to fix it: close at the first `*`s of a longer run, as GitHub does, or fail on such a run.

## The site renders an email address as its text, where GitHub links it

- Where: `unsupported_inline` in `site/markdown.lerta` fails on a bare URL, but not on an email address, which GitHub links as well.
- How to see it: `mail me@lerta.org` comes out as its text, without an error, where GitHub links the address. None is in `docs/` so far.
- How to fix it: fail on a word with an `@` between a name and a domain, as on a bare URL.
