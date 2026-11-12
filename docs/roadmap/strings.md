# Strings

The planned design of `String` and `Binary` beyond [the reference](../reference/types.md#string), and the open questions about their operations.

## Operations and representation

- **Graphemes.** A separate iterator for graphemes, besides the code points that a `String` gives (see [the reference](../reference/types.md#string)).
- **Case.** `s.to_upper()` and `s.to_lower()` of every letter, through the case mappings of Unicode. They change the ASCII letters only so far.
- **A `Char` in an interpolation,** `"#{c}"`, appended as `s + c` appends it, without its `to_string()`. `Char.to_string` would then need no `String` made for each ASCII character: as `'' + @` alone, it now takes 24% more instructions for an ASCII one, given to `to_string` or in an interpolation.
- **Representations,** in priority order:
  1. Small strings (see [below](#small-strings))
  2. Flat strings
  3. **Ropes** (see [below](#ropes))
  4. Slices (see [open questions](#open-questions))
- **FFI.** For I/O, sockets and FFI, `void*` is `Binary` and `char*` is `String`. Encoding conversions are functions between `Binary` and `String`.

### Small strings

A String of at most 7 bytes is held in the word itself, told from a pointer by a tag bit. A `String` stays one word, and a small one is neither allocated nor counted.

- Why 7: 7 bytes hold every word of `bench/word_count` and 70% of the names in the compiler's source. 15, in a 16-byte value, would hold 96%, but would double a `String` in every item, field and union.

Tries so far, each against the same compiler without it:

| Try | Change | `bench/word_count` | Compiler's `dump-llvm` | Set aside until |
|---|---|---|---|---|
| 1 (branch `small-strings`) | In the runtime alone: literals stay flat; `lerta_string_length` and `lerta_string_bytes` read either form | 21% faster | 7% slower, 14% more instructions | Retain and release by type in codegen, with the small test only for `String`, `Binary` and interface values; the reads measured function by function |
| 2 | Retain and release by type: an ownership for references that are never a `String` or a `Binary`, counted without the test, through temporaries, locals and the drop functions, which release each field by its type rather than through the visit function | 13% fewer instructions | 10% more instructions | The std functions that read a `Binary` byte by byte move into the runtime, onto `memchr` and `memcmp` |
| 3 | A `Binary`'s length and bytes read in the generated code, a small one's by shifting the word, so that no read takes its address; literals of at most 7 bytes small too, so that each text has one form and two small ones compare as words | 14% fewer instructions | 9% more instructions | — |

- Try 1: the small strings themselves saved the compiler about 1%. The cost was the test of the tag:
  - About half in retain and release: LLVM can no longer drop the test where it knows a reference is not null, as it cannot know it is not small, so a class object's count pays for it too.
  - The other half in the reads of bytes, such as `lerta_binary_get`, which the compiler then called in loops over long `Binary`s.
- Try 2 took the cost out of class objects (`bench/binary_trees` as before). A profile spreads the rest over the std functions that read a `Binary` byte by byte (`index_of`, `occurs_at`, `split`, `join`, `is_utf8`), each repeating the tag test for every byte, and over appending to small strings.
- Try 3 left the rest spread over building, splitting and comparing strings rather than in any one function. The reads in place stayed, without small strings.

Two ways without the tag were measured against `bench/word_count` (0.62 s then) and set aside, as it ran slower with each. Neither touches what the tag costs the compiler.

- **Interning** the Strings of at most 7 bytes that the runtime makes, in slices and concatenations, as immortal ones found in a table of 64K slots, keyed by the bytes and the length in a word: 0.66 s. The lookup's hash and its cache misses cost more than the allocation and drop it saved, which the allocator's short paths already make cheap.
- **SWAR,** searching a byte 8 at a time, the bytes read as a `UInt64` by a runtime function that LLVM inlines and the first match's place worked out from the word: 0.64 s, and `split` and `join` 8% more. The loop came to 8 instructions for 8 bytes, but a separator there is found within a few bytes, before the search pays for its setup.

### Ropes

A rope keeps a concatenation as a tree, so that `+` is O(1).

- Operations that do not flatten: concatenation, length, iteration, output (`writev`), equality comparison.
- Operations that flatten: byte indexing (`s.binary[i]`), passing to C, hashing (use as a map key).
  - So the O(1) of `s.binary` holds for flat strings. For a rope, the first access costs an O(n) flatten.
- Flattening replaces the node in place, with an explicit stack (no recursion).
- A concatenation with a short result copies at once, without a node (as V8 does below 13 characters).
- Beyond a depth limit, the rope is flattened.

## Regular expressions

- Literals are **syntax-checked at compile time**.
- Dynamic patterns are compiled at run time.
- For literals, the engine's bytecode is embedded in the binary (no parsing at run time). No machine code generation.

## What the compiler needs

In the compiler and std, the positions that text handling needs fall in three kinds:

- **The lexer,** where most of it is, needs byte offsets: in hot loops over a line's bytes, for columns, and to skip what is not UTF-8.
- **The formatter and the language server** count columns in code points and take the text from a column on, as `line.binary.text(width, line.binary.length)!` and a `Scanner` passed over one code point at a time do now.
- **Elsewhere,** no position is wanted, only operations such as "before the last `/`" or "split once at `' @'`".

## Open questions

- Whether the lexer reads bytes, as Go's, Rust's and Zig's do, which suits a syntax of ASCII (an ASCII byte never occurs inside a multi-byte character), or code points, through a std:scanner `Scanner`. Either way, columns could be counted when a diagnostic needs one, rather than through a table per line (`count_code_points`).
- Semantics of the regular expression engine (JS/PCRE-style backtracking vs RE2-style linear time).
