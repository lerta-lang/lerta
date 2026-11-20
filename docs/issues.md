# Issues

Known defects. Each says where it is, how to see it and how to fix it. An issue marked *unverified* was found by reading the code and has not been reproduced.

## A file on a network share gets a URI of four slashes (*unverified*)

- Where: `uri_of_path` in `compiler/lsp/uri.lerta` writes the root of `\\server\share\` into the URI's path, and `path_of_uri` reads a host other than `localhost` as no file.
- How to see it: references in a file whose real path is on a share, as one of a mapped drive may be, give `file:////server/share/a.lerta`, where `file://server/share/a.lerta` is meant.
- How to fix it: write a share as the URI's host, and read a host as a share on Windows.

## The language server finds no declaration for an imported enum or an aliased import's name

- Where: `add_imported_names` in `compiler/lsp/locate.lerta` takes the names that `imports.names` holds by an `ExportRef`, which an imported enum is not, and the name of `import a as b` is held as `b` alone.
- How to see it: in `import Shade, shared as other from './b'`, going to the definition of `Shade`, an enum, or of `shared` gives nothing, so finding references from them gives nothing, and does not list them.
- How to fix it: lead an imported enum's name to its declaration, and the name before `as` too.

## Finding references skips the files of an entry module whose program does not load

- Where: `references` in `compiler/lsp/requests.lerta` checks each entry that `entries_for` picks once, and takes nothing from one whose modules cannot be loaded, as one that imports a missing file.
- How to see it: in a workspace where `main.lerta` imports `./missing` and `./mid`, and `mid.lerta` imports and uses `helper` of the open `lib.lerta`, references of `helper` leave out `mid.lerta`, which would check alone.
- How to fix it: give the wanted files of a failed entry back to `entries_for`, to be held by other entries or checked as entries themselves.

## fmt rewrites a two-way value in a function literal that a `then` value ends with

- Where: the rewrite of a long two-way value in `compiler/format/two_way.lerta`, where the value is the body of a function literal that is the `then` value of another two-way value: its tokens run on to the `else` of the outer value.
- How to see it: `y := x > 0 then (z: Int) -> z > 1 then 1 else 2 else (q: Int) -> 3` in a function: `lerta fmt` says its rewrites would make the program fail to check.
- How to fix it: end the inner value before the `else` of the outer one, or leave a value inside a function literal of a part to the rewrite of the outer value.

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

## A regular expression literal in an interpolation is cut at a `}` or a `"` in it

- Where: `find_interpolation_end` in `compiler/lexer/string_literal.lerta` passes over a string literal in `#{...}`, but not over a regular expression literal.
- How to see it: `print "#{/}/.test('}')}"` fails with `unterminated regular expression`, and `print "#{/"/.test('"')}"` with `unterminated interpolation`, where `"#{'}'}"` gives `}`.
- How to fix it: pass over a regular expression literal there as over a string, where a `/` starts one as the lexer tells it.
