# Strings

The planned design of `String` and `Binary` beyond [the reference](../reference/types.md#string), and the open questions about their operations.

## Operations and representation

- A separate iterator for graphemes, besides the code points that a `String` gives (see [the reference](../reference/types.md#string)).
- `s.to_upper()` and `s.to_lower()` of every letter, which change the ASCII letters only so far, through the case mappings of Unicode.
- The set of representations, in priority order:
  1. Small strings as immediate values (String is a 16-byte value with 15 bytes inline)
  2. Flat strings
  3. **Ropes** (concatenation kept as a tree, so that `+` is O(1))
  4. Slices (see [open questions](#open-questions))
- Rope rules:
  - Operations that do not flatten: concatenation, length, iteration, output (`writev`), equality comparison.
  - Operations that flatten: byte indexing (`s.binary[i]`), passing to C, hashing (use as a map key).
    - So the O(1) of `s.binary` holds for flat strings. For a rope, the first access costs an O(n) flatten.
  - Flattening replaces the node in place. Implemented with an explicit stack (no recursion).
  - A concatenation with a short result copies immediately without creating a node (equivalent to V8's 13 characters).
  - There is a depth limit. Beyond it, the rope is flattened.
- For I/O, sockets and FFI, `void*` is `Binary` and `char*` is `String`. Encoding conversions are provided as functions between `Binary` and `String`.

## Regular expressions

- Literals are **syntax-checked at compile time**.
- Dynamic patterns are compiled at run time.
- For literals, the engine's bytecode is embedded in the binary (no parsing at run time). No machine code generation.

## What the compiler needs

In the compiler and std, the positions that text handling needs fall in two kinds: the lexer, where most of it is, needs byte offsets, in hot loops over a line's bytes, for columns, and to skip what is not UTF-8; elsewhere no position is wanted, only operations such as "before the last `/`" or "split once at `' @'`".

## Open questions

- How to take part of a `String`: a separate type `StringSlice`, as in Swift, whose conversion to `String` is an explicit copy, or a `String` method. With it, how to find a part (an `s.index_of(part)` giving a byte offset or a slice), since a `String` has no integer index (see [the reference](../reference/types.md#string)). `s.binary.text(i, j)!` serves for now, and std:scanner where a String is read through (see [the reference](../reference/std.md#stdscanner)). Since only the lexer needs positions, one answer is that only `Binary` has them, as its byte offsets, which `b.index_of(part, from)` gives already (see [the reference](../reference/types.md#binary)), and `String` only operations without positions: `split_once`, `contains`, `replace` and the like.
- Whether the lexer reads bytes, as Go's, Rust's and Zig's do, which suits a syntax of ASCII (a byte of ASCII never occurs inside a multi-byte character), or code points, through a std:scanner `Scanner`. Either way, columns could be counted when a diagnostic needs one, rather than through a table per line (`count_code_points`).
- Semantics of the regular expression engine (JS/PCRE-style backtracking vs RE2-style linear time).
