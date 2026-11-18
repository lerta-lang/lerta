# Strings

The planned design of `String` and `Binary` beyond [the reference](../reference/types.md#string), and the open questions about their operations.

## Operations and representation

- **Graphemes.** A separate iterator for graphemes, besides the code points that a `String` gives (see [the reference](../reference/types.md#string)).
- **Case** of every letter (see [Unicode](#unicode)).
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

## Unicode

The classes, the case and the normal forms of the characters beyond ASCII, which the methods of `Char` and `String` tell and change for ASCII alone so far (see [the reference](../reference/types.md#char)). They become Unicode's under the same names, in the builtins; no method is kept for ASCII alone. In three steps:

1. **Spaces.** `c.is_space()` tells every character of Unicode's White_Space, as U+3000, which takes no table: a test of the 25 characters by ranges. Below 0x80 it tests as now, and the characters above take a second branch, so that ASCII text pays a comparison at most.
   - `c.is_ascii()` and `s.is_ascii()` are added, for the code that takes ASCII alone, as a format or a protocol does: `c.is_ascii() and c.is_alphanumeric()`.
   - A `Byte`'s methods stay those of ASCII, by tests of their own rather than those of the `Char` of the same number: a byte above 0x7F is part of a UTF-8 sequence, not a character, and `0xA0.is_space()` or `0xC3.is_letter()` would break the code that reads text byte by byte.
   - JSON's spaces are its four alone, so its reader stops taking them by `is_space`.
2. **Classes and case.** Whether a character is a letter (general category L), a number (N), lower or upper case, and its case mapped: simple, one character to one, for a `Char`, and full, as `ß` to `SS`, for a `String`.
   - `c.is_digit()` stays `0` to `9`, as code tests it before it takes the value as `c.to_int() - '0'.to_int()`, which `'٣'` would break.
   - What takes ASCII alone tests it first: the tokens of HTTP and the schemes of URLs, whose names a case mapped beyond ASCII would match otherwise, as the Kelvin sign `K` lowered is `k`; and Lerta's names, in the editor's completion and in the formatter, as the lexer reads them.
   - The headings' anchors of the site then take GitHub's (see [docs/issues.md](../issues.md)).
3. **Normal forms.** `s.normalize(form)`, of NFC, NFD, NFKC and NFKD, by UAX #15: the decompositions, canonical and compatibility, ordered by the combining classes, then composed, the compositions excluded left out, and Hangul by its arithmetic. A quick check by the NFC_QC and NFKC_QC properties returns a String already normal as it is, as an ASCII one is.

### Tables

- Each table is a file of std, a `Binary` that std:builtins [embeds](../reference/modules.md#embedded-files), so that it is a constant, which no program makes as it starts. Its entries are of a fixed size, sorted, and found by a binary search: a range, its first and last code points, of a class; a code point and its mapping, of a case.
- An optimized program, linked with LTO, keeps only those of the methods it calls; this is to be measured.
- The compiler carries std's Binary files as it carries its sources (see [embedded files](../internals/architecture.md#embedded-files)), and gives them by a function of their own, as a `Binary`.
- A script of `tools/` generates the tables from the files of the Unicode Character Database of one version, kept in `third_party/ucd/`, NormalizationTest.txt among them, against which the normal forms are tested.

## Regular expressions

- Literals are **syntax-checked at compile time**.
- Dynamic patterns are compiled at run time.
- For literals, the engine's bytecode is embedded in the binary (no parsing at run time). No machine code generation.
- The engine is written in Lerta: a pattern compiles to bytecode over the UTF-8 bytes, run by a Pike VM. The compiler checks literals and makes their bytecode with the same std code.

### Literals

A literal is written `/.../`, as in JavaScript.

- **Where one starts.** A `/` starts a literal where the token before it is not a value (an identifier, a literal, `)`, `]` or `}`): `x := /a+/`, `f(/a/)`. After a value, it starts one only with whitespace before it and none after, as `f -1` is `f(-1)` (see [calls without parentheses](../reference/syntax.md#calls-without-parentheses)): `split /,\s*/` is `split(/,\s*/)`. Any other `/` divides, `a / b` as `a/b`.
  - So a literal does not start with a space, written `\ ` or `[ ]` instead; and after a value, `/=` is always the operator.
- **Where one ends.** As a string literal ends at its quote: read from the left, a `\` takes the character after it, whatever it is, and the first `/` not so taken ends the literal; a line break before it is an error. `/a\\\/b/` is `\\` and `\/`, and goes on to the last `/`.
  - `[...]` is no exception, as it is in JavaScript: `/[/]/` ends at its second `/`, and the `[` left open is an error at compile time. It is written `/[\/]/`. So the lexer needs to know no syntax of patterns.
  - The lexer only finds where a literal ends; the pattern compiler reads `\/` as `/`.

### Matches

As a `String` has no positions (see [the reference](../reference/types.md#string)), a match gives the text it holds rather than offsets:

- `re.match(s): Match?`, nil where nothing matches; `m[1]: String?` gives a group, and `m.before` and `m.after` the text around the match.
- `re.matches(s)` iterates over the matches; `s.split(re)` and `s.replace(re, (m) -> ...)` take a pattern too.
- Byte offsets are given by functions over a `Binary`, for code such as a lexer.
- `\d`, `\w` and `\s` are those of the `Char` methods: `\d` and `\w` ASCII, `\s` the White_Space of [Unicode](#unicode). `(?i)` folds ASCII alone at first.

### Order

1. Spaces in the builtins, step 1 of [Unicode](#unicode), so that `\s` is `c.is_space()` from the start rather than changing later.
2. Regular expressions with ASCII classes. `\p{...}` is parsed, and is an error at compile time until step 4, so that no pattern accepted earlier changes its meaning then.
   1. Dynamic patterns in `std:regex`, which change no syntax and need no seed refresh.
   2. Literals, their check and their embedded bytecode, in one seed refresh.
   3. Speed: a lazy DFA, and `memchr` for a literal prefix, measured in `bench/`.
3. Steps 2 and 3 of [Unicode](#unicode).
4. `\p{...}` and `(?i)` beyond ASCII, from the tables of `std:unicode`.

## What the compiler needs

In the compiler and std, the positions that text handling needs fall in three kinds:

- **The lexer,** where most of it is, needs byte offsets: in hot loops over a line's bytes, for columns, and to skip what is not UTF-8.
- **The formatter and the language server** count columns in code points and take the text from a column on, as `line.binary.text(width, line.binary.length)!` and a `Scanner` passed over one code point at a time do now.
- **Elsewhere,** no position is wanted, only operations such as "before the last `/`" or "split once at `' @'`".

## Open questions

- Whether the lexer reads bytes, as Go's, Rust's and Zig's do, which suits a syntax of ASCII (an ASCII byte never occurs inside a multi-byte character), or code points, through a std:scanner `Scanner`. Either way, columns could be counted when a diagnostic needs one, rather than through a table per line (`count_code_points`).
- Semantics of the regular expression engine. RE2-style linear time is favored over JS/PCRE-style backtracking: no pattern takes exponential time, and a DFA can be made. Lookaround and backreferences, which it lacks, would be errors at compile time.
- Whether a dynamic pattern with an error gives nil, or throws an error with its message, which a pattern the user typed wants.
- Whether `Regex` is a builtin type or one of `std:regex`; the compiler must know it for literals.
- Whether `a/b`, without whitespace, divides, as `a-b` subtracts, or the rule narrows to "after a value, a `/` with whitespace after it divides".
