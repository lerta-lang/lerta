# Issues

Known defects. Each says where it is, how to see it and how to fix it. An issue marked *unverified* was found by reading the code and has not been reproduced.

## clang 15 fails to build a coroutine with `--source-lines -O`

- Where: the debug information that `--source-lines` gives the code of a function that awaits, under clang 15 (Ubuntu 22.04's) with `-O`. clang 21 on macOS and llvm-mingw on Windows build it.
- How to see it: `import sleep from 'std:time'`, then `await sleep(0.01)`, built with `lerta build -O --source-lines` on Ubuntu 22.04: clang stops with `Intrinsic has incorrect argument type!` for `@llvm.coro.end` and `Broken module found`.
- How to fix it: find what the debug information changes in the coroutine's IR that clang 15's verifier rejects, as the type that `llvm.coro.end` is declared with.

## A heading's anchor drops the combining marks

- Where: `slug` in `site/markdown.lerta` keeps the letters and numbers of a heading, and `_`, but not its combining marks (general category M) nor its connector punctuation (Pc) but `_`, which GitHub keeps too, as std tells no class of them.
- How to see it: `# Cafe\u{301}`, with U+0301 after the `e`, gets the anchor `cafe`, where GitHub gives `cafe\u{301}`, so that a link written for GitHub does not reach the heading on the site.
- How to fix it: keep the marks and the connector punctuation, once std tells them.

## The site renders emphasis closed by a longer run of `*` as its text

- Where: `closing_emphasis` in `site/markdown.lerta` closes emphasis only at a run of as many `*` as open it.
- How to see it: `**x***` and `a *b***` come out as their text, without an error, where GitHub renders `<strong>x</strong>*` and `a <em>b</em>**`.
- How to fix it: close at the first `*`s of a longer run, as GitHub does, or fail on such a run.

## The site renders an email address as its text, where GitHub links it

- Where: `unsupported_inline` in `site/markdown.lerta` fails on a bare URL, but not on an email address, which GitHub links as well.
- How to see it: `mail me@lerta.org` comes out as its text, without an error, where GitHub links the address. None is in `docs/` so far.
- How to fix it: fail on a word with an `@` between a name and a domain, as on a bare URL.

## Binary.uint32_at checks its range three times where C checks once

- Where: `uint32_at` in `std/builtins/text.lerta`, built with `-O`.
- How to see it: its machine code tests `index` against the length, the overflow of `index * 4` and `index * 4 + 3` against the length before its one load, where C's `p = bytes + 4 * i` checks once. LLVM does not see `4 * index + 3 < length` from `index < length / 4`, so the last test stays to drop the checks of the four bytes. Checking a Binary's index as unsigned, in one comparison, made the compiler and `bench/json` 1% slower, as a loop's condition no longer drops it.
- How to fix it: give LLVM the bound of the four bytes from the one test of `index`, if a form of it does, and measure where `uint32_at` is used.
