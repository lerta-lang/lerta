# Strings

The planned design of `String` and `Binary` beyond [the reference](../reference/types.md#string), and the open questions about their operations.

## Operations and representation

- A separate iterator for graphemes, besides the code points that a `String` gives (see [the reference](../reference/types.md#string)).
- `s.to_upper()` and `s.to_lower()` of every letter, which change the ASCII letters only so far, through the case mappings of Unicode.
- A `for` over a `String` as fast as one over its bytes. `for c in s` takes about 110 instructions for each ASCII character, against 10 for `for b in s.binary`: `s.iter()` allocates a `Chars` and the `Iter` that it is given as, each item goes through `has_next` and `next` by their code pointers, then `Chars.next` and `char_at`, none inlined, and `char_at` decodes an ASCII byte as it does a sequence. Ways: a `for` over a `String` built into the compiler, which reads the UTF-8 in the loop as one over an array reads its items; or `iter` as a function that yields, with such a `for` fused as one over a call of it is (see [fused loops](../internals.md#fused-loops)); and a short way for ASCII in `Chars.next`, which helps either.
- A `Char` in an interpolation, `"#{c}"`, appended as `s + c` appends it, without its `to_string()`. `Char.to_string` would then need no `String` made once for each ASCII character: as `'' + @` alone, it now takes 24% more instructions for an ASCII one, given to `to_string` or in an interpolation.
- The set of representations, in priority order:
  1. Small strings as immediate values: a String of at most 7 bytes is held in the word itself, told from a pointer by a tag bit, so that a `String` stays one word and a small one is neither allocated nor counted. 7 bytes hold every word of `bench/word_count` and 70% of the names in the compiler's source; 15, in a 16-byte value, would hold 96%, but would double a `String` in every item, field and union.
     - A first try, kept on the branch `small-strings`, in the runtime alone (literals stay flat; `lerta_string_length` and `lerta_string_bytes` read either form), made `bench/word_count` 21% faster but the compiler's own `dump-llvm` 7% slower, 14% more instructions, measured against the same compiler without it. The small strings themselves saved the compiler about 1%; the cost was the test of the tag: in retain and release, about half of it, as LLVM can no longer drop the test where it knows a reference is not null but cannot know it is not small, so a class object's count pays for it too; and in the reads of bytes, such as those of `lerta_binary_get`, which the compiler called then, in loops over long Binarys, the other half. It was set aside until both are cut: retain and release by type in codegen, the small test only for `String`, `Binary` and interface values, and the reads to be measured function by function.
     - A second try added retain and release by type: an ownership for references that are never a `String` or a `Binary`, counted without the test, through temporaries, locals and the drop functions too, which release each field by its type rather than through the visit function. That took the cost out of class objects (`bench/binary_trees` as before) but left the compiler 10% more instructions, while `bench/word_count` took 13% fewer. A profile spreads the rest over the std functions that read a `Binary` byte by byte, as `index_of`, `occurs_at`, `split`, `join` and `is_utf8`, each test of the tag repeated for every byte, and over appending to small strings. It was set aside again until those functions move into the runtime, onto `memchr` and `memcmp`.
     - A third try read a `Binary`'s length and bytes in the generated code, a small one's by shifting the word, so that no read takes its address, and made the literals of at most 7 bytes small too, so that each text has one form and two small ones compare as words. The compiler still ran 9% more instructions, the rest spread over building, splitting and comparing strings rather than in any one function, and `bench/word_count` 14% fewer. The reads in place stayed, without small strings.
     - Two ways without the tag were measured against `bench/word_count` (0.62 s then) and set aside, as it ran slower with each. Interning the Strings of at most 7 bytes that the runtime makes, in slices and concatenations, as immortal ones found in a table of 64K slots, keyed by the bytes and the length in a word, so that they are neither allocated nor counted, took 0.66 s: the lookup's hash and its misses in the cache cost more than the allocation and the drop that it saved, which the allocator's short paths already make cheap. Searching a byte 8 at a time (SWAR), the bytes read as a `UInt64` by a runtime function that LLVM inlines and the place of the first match worked out from the word, took 0.64 s, and `split` and `join` 8% more: the loop came to 8 instructions for 8 bytes, but a separator there is found within a few bytes, before the search pays for its setup. Neither touches what the tag costs the compiler.
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

In the compiler and std, the positions that text handling needs fall in three kinds: the lexer, where most of it is, needs byte offsets, in hot loops over a line's bytes, for columns, and to skip what is not UTF-8; the formatter and the language server count columns in code points and take the text from a column on, as `line.binary.text(width, line.binary.length)!` and a `Scanner` passed over one code point at a time do now; elsewhere no position is wanted, only operations such as "before the last `/`" or "split once at `' @'`".

## Open questions

- How to take part of a `String`: a separate type `StringSlice`, as in Swift, whose conversion to `String` is an explicit copy, or a `String` method. With it, how to find a part (an `s.index_of(part)` giving a byte offset or a slice), since a `String` has no integer index (see [the reference](../reference/types.md#string)). `s.binary.text(i, j)!` serves for now, and std:scanner where a String is read through (see [the reference](../reference/std.md#stdscanner)). Since only the lexer needs positions, one answer is that only `Binary` has them, as its byte offsets, which `b.index_of(part, from)` gives already (see [the reference](../reference/types.md#binary)), and `String` only operations without positions: `split_once`, `contains`, `replace` and the like.
- Whether the lexer reads bytes, as Go's, Rust's and Zig's do, which suits a syntax of ASCII (a byte of ASCII never occurs inside a multi-byte character), or code points, through a std:scanner `Scanner`. Either way, columns could be counted when a diagnostic needs one, rather than through a table per line (`count_code_points`).
- Semantics of the regular expression engine (JS/PCRE-style backtracking vs RE2-style linear time).
- Operations without positions that a `String` lacks: the number of its bytes, which code takes as `s.binary.length` now.
