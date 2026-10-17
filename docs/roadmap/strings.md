# Strings

The planned design of `String` and `Binary` beyond [the reference](../reference/types.md#string), and the open questions about their operations.

## Operations and representation

- A separate iterator for graphemes, besides the code points that a `String` gives (see [the reference](../reference/types.md#string)).
- `s.to_upper()` and `s.to_lower()` of every letter, which change the ASCII letters only so far, through the case mappings of Unicode; and the number of code points.
- A `StringBuilder` of the runtime, so that `join`, `to_string`, `repeat` and `pad` can be written in Lerta as efficiently as in C: `StringBuilder(capacity: n)` reserves room, `b.write(s)` copies the bytes of a `String` at once, and `b.to_string()` hands its storage over as the `String`, trimmed to its length and without a copy, leaving the builder empty. A `Byte[]` cannot serve, since `to_binary()` copies it again.
- Ropes, so that `+` is O(1).
- Small strings as immediate values.
- For I/O, sockets and FFI, `void*` is `Binary` and `char*` is `String`. Encoding conversions are provided as functions between `Binary` and `String`.

## Regular expressions

- Literals are **syntax-checked at compile time**.
- Dynamic patterns are compiled at run time.

## What the compiler needs

In the compiler and std, the positions that text handling needs fall in two kinds: the lexer, where most of it is, needs byte offsets, in hot loops over a line's bytes, for columns, and to skip what is not UTF-8; elsewhere no position is wanted, only operations such as "before the last `/`" or "split once at `' @'`".

## Open questions

- How to take part of a `String`: a separate type `StringSlice`, as in Swift, whose conversion to `String` is an explicit copy, or a `String` method. With it, how to find a part (an `s.index_of(part)` giving a byte offset or a slice), since a `String` has no integer index (see [the reference](../reference/types.md#string)). `s.binary.text(i, j)!` serves for now. Since only the lexer needs positions, one answer is that only `Binary` has them (byte offsets, as `b.index_of(byte_or_part, from)`), and `String` only operations without positions: `split_once`, `contains`, `replace` and the like.
- Whether to have a type that reads a `String` by code points, as Go's `text/scanner`, Swift's `Scanner` or Rust's `Chars`: `peek()`, `next()`, `mark()` and `text_from(mark)`, working on byte offsets inside without showing them. It would keep positions out of `String`'s operations, and let the lexer read characters; a plain `Iter` lacks peeking and taking the text of a token.
- Whether the lexer reads bytes, as Go's, Rust's and Zig's do, which suits a syntax of ASCII (a byte of ASCII never occurs inside a multi-byte character), or code points, through such a scanner. Either way, columns could be counted when a diagnostic needs one, rather than through a table per line (`count_code_points`).
- Whether a `StringBuilder` takes single bytes, `b.write_byte(byte)`: limited to ASCII, so that `to_string()` needs no check of UTF-8, or any byte, with `to_binary()` beside it and `to_string()` checking.
- The reference says there is no `StringBuilder`, since `push` onto a `String[]` and `join` is O(n) ([types](../reference/types.md#string)), while one is planned above for writing `join` and the like in Lerta: settle which reason holds.
- Semantics of the regular expression engine (JS/PCRE-style backtracking vs RE2-style linear time).
