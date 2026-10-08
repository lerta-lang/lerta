# Strings

`String`, `Binary`, `Byte`, `s.binary`, `b.decode_utf8()`, `s.parse_int()`, `b.slice`, `b[i]` and `join` are implemented: see [the reference](../reference/types.md#string). Why: UTF-8 (a PEP 393 style variable-width representation was considered, but UTF-8 was chosen because of the conversion cost at I/O boundaries); `Binary` separate from `String`, which only adds the invariant "valid UTF-8", rather than the Python 2 / Go idea that "a string is any byte sequence"; no integer indexing `s[i]`, to prevent the mistake of taking it for a character; and no StringBuilder, since `push` onto an `Array<String>` and `join` is O(n) (the Python approach), an idiom that stays valid once ropes make `+` O(1). Planned:

- `s.chars()` for characters (their type is an [open question](../roadmap.md#open-questions)), and a separate iterator for graphemes.
- Slicing uses a separate type `StringSlice`, as in Swift. Converting to `String` is an explicit copy.
- For I/O, sockets and FFI, `void*` is `Binary` and `char*` is `String`. Encoding conversions are provided as functions between `Binary` and `String`.

## Regular expressions

- Literals are **syntax-checked at compile time**.
- Dynamic patterns are compiled at run time.
