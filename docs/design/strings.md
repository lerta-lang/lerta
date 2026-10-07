# Strings

- **Immutable.**
- The internal representation is **UTF-8**. (A PEP 393 style variable-width representation was considered, but UTF-8 was chosen because of the conversion cost at I/O boundaries.)
- There is **no** integer indexing `s[i]` (to prevent the mistake of taking it for a character). For bytes use `s.binary[i]`, for characters `s.chars()`, and for graphemes a separate iterator.
- **`Binary`** (an immutable byte sequence) is separate from `String`. **`Byte`** is an alias of `UInt8`. Lerta does not adopt the Python 2 / Go idea that "a string is any byte sequence".
  - `Binary` and `String` have **the same internal representation**. `String` only adds the invariant "valid UTF-8".
  - `s.binary` needs no validation and is O(1). `b.decode_utf8()` validates and is O(n); on failure it returns nil (`String?`; to make it an exception, `b.decode_utf8()!`).
  - Conversion to an integer is `s.parse_int(): Int?`.
  - A mutable byte sequence is `Array<Byte>`.
  - A subsequence is `b.slice(start, end): Binary` (`end` is exclusive; out of range throws; since it is immutable, copying or sharing is up to the implementation).
  - For I/O, sockets and FFI, `void*` is `Binary` and `char*` is `String`. Encoding conversions are provided as functions between `Binary` and `String`.
- Slicing uses a separate type `StringSlice`, as in Swift. Converting to `String` is an explicit copy.
- There is **no** StringBuilder. To build a string in a loop, `push` onto an `Array<String>` and `join` (the Python approach, O(n)). Once ropes are introduced, `+` becomes O(1), but the idiom stays valid.

## Regular expressions

- Literals are **syntax-checked at compile time**.
- Dynamic patterns are compiled at run time.
