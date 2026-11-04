# Types

| Kind | Types |
|---|---|
| Numbers | `Int`, `Byte`, the [sized integers](#sized-integers) such as `Int32`, `Float`, `Float32` |
| Text and bytes | `Char`, `String`, `Binary` |
| Other builtin types | `Bool`, `T[]`, `Map<K, V>`, `Set<T>`, `Iter<T>`, `Promise<T>` and `Promise` |
| Composed | `T?`, unions `A \| B`, function types, anonymous structs such as `{ x: Int }`, tuples such as `(Int, String)` |
| Named | classes, structs, enums, interfaces and `type` aliases |
| In generic code | `Self` in an [interface](objects.md#interfaces) or an extend of one; the type parameters of a generic function, class, struct or extend, inside it |
| Return types only | `void`, `never` |

- How types are written: [the syntax](syntax.md#types).
- The methods of the builtin types: [builtins](builtins.md#methods-of-the-builtin-types). A method is called, or is a function value where a function type is expected (see [function values](functions.md#function-values)).

## Int

- `Int` is a signed 64-bit integer.
- A literal must fit in `Int`, sign included: the minimum is `-9223372036854775808`, or `-0x8000000000000000`.

### Operators

| Operator | Rule |
|---|---|
| `==` `!=` `<` `<=` `>` `>=` | Give a `Bool`. |
| `+` `-` `*`, prefix `-` | Throw `integer overflow` when the result does not fit. |
| `/` | The quotient, truncated toward zero: `-7 / 2 == -3`. |
| `%` | The remainder: `-7 % 2 == -1`. |
| `&` `\|` `^` | Bitwise and, or, exclusive or. `x ^ -1` inverts the bits. |
| `x << n` | Throws `integer overflow` unless the result fits, as `x` times 2 to the `n` would; so it never changes the sign. |
| `x >> n` | Shifts in copies of the sign bit. |

- `/` and `%` throw `division by zero` when the divisor is 0, and `integer overflow` for the minimum divided by `-1`.
- A shift throws `shift out of range` when `n` is negative or 64 or more.

### Methods

- `x.wrapping_add(y)`, `wrapping_sub`, `wrapping_mul`: the same operations without the check, wrapping around modulo 2 to the 64, for hashes and checksums.
- `n.to_hex(width = 0)`: lower-case hexadecimal, with zeros before it to make `width` digits. `255.to_hex()` is `'ff'`, `10.to_hex(4)` is `'000a'`; `.to_upper()` gives upper case. A negative `n` throws a `ValueError`, as it has no one such text.
- Conversions: see [sized integers](#integer-conversions) and [Float](#float).

### Why

- One name each for `Int` and `Byte`, rather than also `Int64` and `UInt8`: the common types have no second name to choose between.
- The arithmetic of every integer type throws on overflow, an unsigned one too: a size that went below 0 would otherwise silently be a large number. A computation that means to wrap around says so with a method, so that an operator has one rule for every type.
- A bitwise operator works on bits: `<<` of an unsigned type drops the bits shifted out, while that of a signed type checks, as it would change the sign.

## Byte

- `Byte` is an unsigned 8-bit integer.

### Operators

| Operator | Rule |
|---|---|
| `+` `-` `*` | Throw `integer overflow` outside 0 to 255: `250 + 10`, `1 - 2`. |
| prefix `-` | None: it would throw for all but 0. |
| `/` `%` | Throw `division by zero` when the divisor is 0. |
| Comparisons | Unsigned. |
| `&` `\|` `^` | Bitwise. |
| `b << n` | Drops the bits shifted out. |
| `b >> n` | Shifts in zeros. |

- A shift throws `shift out of range` when `n` is 8 or more.
- `wrapping_add`, `wrapping_sub` and `wrapping_mul` wrap around modulo 256: `250.wrapping_add(10)` is `4`.

### Conversions

- No implicit conversions: `Byte` and `Int` cannot be mixed in one operation.
- `b.to_int()` gives an `Int`.
- `n.to_byte()` gives a `Byte?`, nil outside 0 to 255: `n.to_byte() ? 0`, or `n.to_byte()!` where it must fit (see [integer conversions](#integer-conversions)).

### Byte methods

| Method | Tells or gives |
|---|---|
| `b.is_digit()` | An ASCII digit. |
| `b.is_letter()` | An ASCII letter, `a` to `z`, `A` to `Z`. |
| `b.is_space()` | A space, `\t`, `\n` or `\r`. |
| `b.is_utf8_continuation()` | A byte that continues a UTF-8 sequence, 0x80 to 0xBF, as when counting the code points of a `Binary`. |
| `b.hex_value()` | The value of a hexadecimal digit of either case, 0 to 15, or nil. |

### Literals by context

**The type of a literal is decided by context.** Where a `Byte` or a `Byte?` is expected, an integer literal from 0 to 255 is a `Byte`, and so is a string literal of one byte (`'a'`). Without such a context, `'a'` is a `String` and `1` an `Int`.

The expected type reaches literals:

- in the items of an array literal where an array type is expected: `xs: Byte[] = [1, 2]`;
- inside arithmetic: `c == 1 + 2`;
- in `case` arms and return values;
- in an array literal spread in another: `[[1, 2]..., c]`;
- in an operand of `+`, `==`, `<` and so on whose type comes from the context, which is expected to have the type of the other operand: `c >= '0'` and `'0' <= c` compare two `Byte`s when `c` is one;
- in the items of an array literal, which take the type of the first item whose type does not come from the context: `[1, c]` is a `Byte[]` (see [array literals](#array-literals));
- in the items of an array literal after `in`, when all of them take their type from the context and the item tested does not, and is of a type that `==` compares: `c in ['a', 'b']` tests a `Byte[]`.

## Sized integers

```
flags: UInt16 = 0x8001
offset: Int32 = -4
print (flags >> 15).to_int() + offset.to_int()
```

| Bits | Signed | Unsigned |
|---|---|---|
| 8 | `Int8` | `Byte` |
| 16 | `Int16` | `UInt16` |
| 32 | `Int32` | `UInt32` |
| 64 | `Int` | `UInt64` |

`Byte` and `Int` have no second names.

### Rules

A signed type takes the rules of [`Int`](#int), an unsigned one those of [`Byte`](#byte):

- `+` `-` `*` throw `integer overflow` when the result does not fit.
- `/` and `%` throw `division by zero`; the least value of a signed type divided by `-1` overflows.
- Comparisons follow the sign. Prefix `-` is for the signed types.
- `&` `|` `^` `<<` `>>` work by the type's bits. A shift throws `shift out of range` from the number of bits up. `<<` of a signed type checks as that of `Int` does.
- `wrapping_add`, `wrapping_sub` and `wrapping_mul` wrap around modulo 2 to the bits.

### Literals

- An integer literal is of the integer type expected, and must fit in it; elsewhere it is an `Int`.
- A `UInt64` literal cannot be above the largest `Int` so far.

### Integer conversions

- No implicit conversions between integer types.
- `x.to_int()`, `x.to_byte()`, `x.to_int8()`, `x.to_int16()`, `x.to_int32()`, `x.to_uint16()`, `x.to_uint32()` and `x.to_uint64()` convert a value of any integer type.
  - Where every value of the source type fits in the target, as every `Byte` fits in an `Int`, the result is of the target type.
  - Otherwise it is optional, nil for a value that does not fit: `x.to_int()` of a `UInt64` is an `Int?`. A negative value fits in no unsigned type.
  - A type holds every value of another if it has no fewer bits and the same sign, or more bits than an unsigned one.
- `x.to_float()` gives the nearest `Float`.
- `x.to_string()` gives the decimal digits, with a `-` for a negative value.
- Why nil rather than an exception: whether a value fits is often a question about input, which the caller answers with `? return`, a fallback or a message of its own; a caller that knows it fits says so with `!`. A check before the conversion would repeat the conversion's own. Arithmetic still throws, as an overflow there is a bug rather than a question.

### Equality, keys and C

- They compare with `==`, are map keys and set items, are written by an array's `to_string`, and are patterns of a `case`.
- Arrays and maps hold each at its own size.
- A C function takes and gives them as the C types of their bits and sign, as `int32_t`.

## Char

```
kana := (c: Char) -> c in 'ぁ'..'ゖ' then c + 0x60 else c
print [kana(c).to_string() for c in 'ひらがな'].join('')
```

- `Char` is a Unicode scalar value: a code point from 0 to 0x10FFFF, except the surrogates, 0xD800 to 0xDFFF.
- A `String` gives its code points as `Char`s (see [String iteration](#string-iteration)).

### Literals

- Where a `Char` or a `Char?` is expected, a string literal of one code point is that `Char`: `c == 'é'`.
- One of no code point, or of more, is an error there, as `'é'` written as `e` and a combining accent is.
- An integer literal is no `Char`.
- Where a union with a `String` member is expected, a string literal is the `String`.

### Operators

- `c + n` and `c - n`, with `n` an `Int`, give the `Char` `n` places on or back.
  - Where there is none, as among the surrogates or beyond 0x10FFFF, they throw a `ValueError`, `not a Unicode scalar value`; where the number would not fit in an `Int`, `integer overflow`.
  - They are the methods `add` and `sub` of `Char`, called as an operator calls those of any type (see [operators](objects.md#operators)). So a string literal on the left is a `String`, as nothing expects a `Char` there: write `c + 1` of a `Char` `c`, not `'a' + 1`.
- No other arithmetic. The distance between two `Char`s is `c.to_int() - d.to_int()`.
- `==`, `<` and the like compare by number.
- A `Char` is not compared with an integer, nor mixed with one in another operation, except `+` and `-` with an `Int` on the right.

### Methods and conversions

- `c.to_string()`, which `print` and interpolation use, gives the `String` of the code point.
- `c.to_int()` gives its number.
- `n.to_char()`, of any integer type, gives the `Char` of a number as a `Char?`, nil for a number that is none; of a `Byte`, which always is one, a `Char`.
- `c.is_digit()`, `c.is_letter()` and `c.is_space()` tell what those of a [`Byte`](#byte-methods) tell, so they are true only for ASCII: `'０'`, `'é'` and U+3000 are in no class. So are `c.is_lower()` and `c.is_upper()`, of the ASCII letters of each case.
- `c.to_upper()` and `c.to_lower()` change the case of an ASCII letter, as those of a `String` do, and give any other `Char` as it is; `c.hex_value()` gives what that of a `Byte` gives, or nil for a `Char` beyond the `Byte`s.

### Keys, items and JSON

- `Char`s are map keys, set items, patterns of a `case`, items of arrays and members of unions.
- `std:json` does not convert `Char`s so far.

### Why

- A type of its own rather than an alias of `UInt32`: a `Char`'s text is the character, not its number, and every `Char` is a scalar value, so `to_string` cannot fail. Arithmetic on code points is moving through them, which `+` and `-` of an `Int` give.
- Not graphemes: a `Char` is what UTF-8 encodes one at a time, as Rust's `char` is; a grapheme, what is seen as one character, may be several.

## Float

- `Float` is a 64-bit IEEE 754 double that is never NaN: an operation whose result would be NaN throws `not a number` instead.
- So `==` holds for every value and its own copy, and `<` orders all values, the infinities beyond all others.
- [std:math](std.md#stdmath) names the infinities `INFINITY` and `-INFINITY`.

### Literals

- A literal has a fraction, an exponent or both: `1.5`, `1e9`, `2.5e-3` (see [syntax](syntax.md)). It rounds to the nearest double.
- One too large to be finite is an error; an infinity is written `INFINITY`.
- **Where a `Float` or a `Float?` is expected, an integer literal is a `Float` too**, `x: Float = 3`, as it is a `Byte` where one is expected (see [Byte](#literals-by-context)).
  - A decimal one may then be beyond `Int`, rounding as a float literal does: `x: Float = 18446744073709551616`.
  - A hexadecimal one may not, as it stands for the bits of an `Int`.

### Arithmetic

- `+` `-` `*` `/` and prefix `-` follow IEEE 754.
- A result too large to be finite is an infinity of its sign; so is a nonzero number divided by zero, of the sign of the two: `1.0 / -0.0` is `-INFINITY`.
- A result that would be NaN throws `not a number`: `0.0 / 0.0`, an infinity less itself, zero times an infinity, an infinity divided by one.
- There is no `%`.

#### Where NaN is checked

The NaN is thrown where the value is used, since the operations that a NaN goes on through give a NaN:

- A local that holds the result of arithmetic holds it unchecked until its value leaves it: as the argument of a call, into a field or an item, in a comparison, as a return value, or converted.
- A chain of operations throws at its last one, after the calls in it, whose arguments are checked as they are passed.

So `not a number` may be reported at a line after the one that makes the NaN, and a NaN never used throws nowhere. [`--eager-nan-checks`](compiler.md#build) throws at each operation that makes one.

### Comparison

- Comparisons and `==` follow IEEE 754: `-0.0 == 0.0`. A map or set of `Float`s holds the two as one key, `0.0`.
- `0.1 + 0.2 == 0.3` is false, as the doubles nearest these values do not add up exactly.
- `case` cannot branch on a `Float`, as an exact value is rarely what a branch means.

### Conversions

- No implicit conversions: `Float` and `Int` cannot be mixed in one operation.
- `n.to_float()` gives the nearest `Float` to an `Int`.
- `x.to_int()` gives the `Int` of a `Float` truncated toward zero, as an `Int?`: nil unless it fits, as an infinity does not.

### Text

- `x.to_string()`, which `print` and interpolation use, gives the fewest digits that read back as the value, as Python writes them:
  - positional from `1e-4` up to `1e16`, with `.0` for a whole number: `1.0`, `0.30000000000000004`, `-0.0`;
  - scientific beyond: `1e+16`, `5e-324`;
  - `inf` or `-inf` for an infinity, which `parse_float` reads back (see [parsing numbers](#parsing-numbers)).
- The `to_literal` of an infinity is `INFINITY` or `-INFINITY`, which names std:math's, as a program imports it.
- `x.to_fixed(digits)` gives `x` with `digits` digits after the point, 0 to 18, and no point for 0: `3.14159.to_fixed(2)` is `'3.14'`, `2.5.to_fixed(0)` is `'3'`.
  - It writes the whole part exactly, however large: `1e20.to_fixed(0)` is `'100000000000000000000'`.
  - It rounds the fraction times 10 to the `digits` half away from zero, carrying into the whole part. That product is a `Float`, which may round, so a fraction just below a half, as that of the double nearest `0.995`, may round up.
  - A negative value that rounds to 0 has no `-`.
  - An infinity, and `digits` outside the range, throw a `ValueError`.

### Why

- No NaN: a NaN goes on silently through arithmetic until a comparison much later gives a wrong answer, and makes `==` fail for a value and itself. So it throws before it is used.
- Checked where used rather than at each operation: arithmetic that goes through locals checks once at its end.
- Infinities kept: an infinity compares and orders, and a computation that overflows may go on with it, as numeric code expects. Checking each result for NaN alone is about half the cost of checking it for an infinity too, as the check needs no magnitude.

## Float32

- `Float32` is a 32-bit IEEE 754 float, never NaN as `Float` is.
  - Its operations are in 32 bits; they give an infinity where the result is too large for a `Float32`, and throw where it would be NaN.
  - It compares, is a map key and a set item, and is written by an array's `to_string`. `case` cannot branch on it.
- It does not mix with `Float` in one operation.
- Where a `Float32` or a `Float32?` is expected, a float or integer literal is a `Float32`. It rounds to the nearest `Float32` at once; one too large to be finite as a `Float32` is an error.
- `x.to_float32()` gives the nearest `Float32` to a `Float`, an infinity beyond the largest. `x.to_float()` gives the `Float` of a `Float32`, exactly.
- `x.to_string()` gives the fewest digits that read back as the `Float32`, written as a `Float`'s are: `0.1`, `0.33333334`, `3.4028235e+38`. An infinity's `to_literal` is `INFINITY.to_float32()`.
- A C function takes and gives a `Float32` as a `float`.

## Bool

- `Bool` has the values `true` and `false`.
- `==` and `!=` compare two `Bool`s. There is no ordering.

## String

- A `String` is immutable text in UTF-8.
- `==` and `!=` compare two `String`s byte by byte.
- `a.compare(b)` is `LESS`, `EQUAL` or `GREATER` as `a` goes before, with or after `b` in the order of their bytes, which does not depend on a locale; a prefix goes first. `<`, `<=`, `>` and `>=` order `String`s so.

### Concatenation

- `+` concatenates two `String`s into a new one. `s + c` of a [`Char`](#char) `c` appends its UTF-8; a string literal there is a `String`, as `+` expects one.
- `+=` appends to a variable.
  - It appends in place to a `String` that nothing else holds, so a loop of `+=` is O(n) in all.
  - One that something else holds, as another variable, an array, a closure or a `for` going through it, is copied first, once; the copy is held by the variable alone.
  - A loop that shares the `String` again at each step, as by pushing it onto an array before each `+=`, copies it each time: O(n²).
- String literals joined by `+`, as `'a long ' +` and `'text'` on the next line, are joined into one literal by the compiler, as any [constant expression](#constant-expressions) is.

### Methods

| Method | Gives |
|---|---|
| `s.split(separator)` | The pieces between the occurrences of `separator`, empty ones too, as a `String[]`: `'a,,b'.split(',')` is `['a', '', 'b']`, `''.split(',')` is `['']`. |
| `s.split_once(separator)` | What comes before the first occurrence and after it, as a `(String, String)`, or nil: `'k = v = w'.split_once(' = ')` is `('k', 'v = w')`. |
| `s.split_whitespace()` | The pieces between runs of the ASCII spaces, tabs, carriage returns and newlines, none empty: `' a  b '.split_whitespace()` is `['a', 'b']`. |
| `s.lines()` | The lines of `s` without their `\n` or `\r\n`, and no empty line after a last `\n`: `"a\r\nb\n".lines()` is `['a', 'b']`, `''.lines()` is `[]`. |
| `s.starts_with(prefix)`, `s.ends_with(suffix)` | Whether `s` begins or ends with those bytes. |
| `s.without_prefix(prefix)` | What follows `prefix`, or nil if `s` does not begin with it: `'std:io'.without_prefix('std:')` is `'io'`. |
| `s.without_suffix(suffix)` | What comes before `suffix`, or nil. |
| `s.contains(part)` | Whether the bytes of `part` occur in `s`; every `String` contains the empty one. A `Char` is taken as its `String`: `'abc'.contains(c)`. |
| `s.is_digits()` | Whether `s` is one or more ASCII digits: no sign, not empty. |
| `s.replace(part, by)` | `s` with each occurrence of `part`, from the start and without overlapping, replaced by `by`. |
| `s.trim()`, `s.trim_start()`, `s.trim_end()` | `s` without the ASCII spaces, tabs, carriage returns and newlines at both ends, the start or the end. |
| `s.repeat(n)` | `n` copies of `s` one after another. |
| `s.pad_start(width, fill = ' ')` | `s` after as many copies of `fill`, one code point, as make it `width` code points long, or `s` itself if it is no shorter: `'7'.pad_start(3, '0')` is `'007'`. |
| `s.pad_end(width, fill = ' ')` | The same with the copies after `s`. |
| `s.to_upper()`, `s.to_lower()` | `s` with the case of the ASCII letters changed, every other character as it is: `'café'.to_upper()` is `'CAFé'`. |

These throw a `ValueError`:

- `split` and `split_once` with an empty separator: `split by an empty separator`;
- `replace` with an empty `part`;
- `repeat` with a negative `n`;
- `pad_start` and `pad_end` with a fill of more or fewer than one code point, even where none would be added.

`s.parse_int()` and `s.parse_float()` are under [parsing numbers](#parsing-numbers).

### String iteration

- A `String` is [Iterable](builtins.md#iterable): `for c in s`, comprehensions and `s.iter()` give its code points as [`Char`](#char)s, in order. `'é'` gives the `Char` of 233.
- Its bytes are `s.binary` (see [Binary](#binary)).
- It has no `length`; `s.count()` counts its code points (see [Iter](#consuming-methods)).

### Why

- Code points rather than bytes or graphemes: a `Binary` already gives the bytes, and code points are what UTF-8 encodes, while graphemes need Unicode's tables.
- UTF-8: a PEP 393 style variable-width representation was considered, but it costs a conversion at every I/O boundary.
- No integer indexing `s[i]`, which could be taken for a character.
- No StringBuilder, since `+=` appends in place (see [internals](../internals/representation.md#strings)).

## Binary

- `Binary` is an immutable sequence of bytes; a mutable one is a `Byte[]`.
- A literal writes one: `b'GET '`, `b"\xFF#{body}"` (see [the syntax](syntax.md)). `b''` is the empty one.
- `==` and `!=` compare two `Binary`s byte by byte.
- Why separate from `String`: a `String` only adds the invariant "valid UTF-8", rather than "a string is any byte sequence" as in Python 2 and Go.

### Conversions

- `s.binary` gives the bytes of a `String`, its UTF-8, without copying them.
- `b.text(start = 0, end = b.length)` gives those bytes as a `String` if they are valid UTF-8, or nil. It throws an `IndexError` if they are out of range. `b.text()` gives the whole `Binary` without copying it.
  - `b.text()!` or `b.text() ? throw ...` takes a `String` where the bytes must be UTF-8.
- `bytes.to_binary()` copies the items of a `Byte[]` into a new `Binary`.

### Indexing

- `b.length` is the number of bytes.
- `b[i]` is the byte at `i`, a `Byte`. An index outside `0 ... b.length` throws `index out of range`; `b.get(i)` gives nil instead.
- `b[start...end]` copies the bytes from `start` up to, not including, `end` into a new `Binary`, as an [array's](#slices) does.

### Joining

- `+` joins two `Binary`s into a new one, `b + byte` appends a `Byte`, and `+=` appends to a variable, as for `String`s. An integer literal there is no `Byte`, as `+` expects a `Binary`.
- A `String` and a `Binary` are not joined: `cannot join a String and a Binary`.
- An array's `join` joins a `Binary[]` into one. Pieces gathered so and joined once are O(n), as for `String`s.

### Methods

| Method | Gives |
|---|---|
| `b.first()`, `b.last()` | The first or the last byte, or nil if empty. |
| `b.starts_with(prefix)`, `b.ends_with(suffix)` | Whether `b` begins or ends with the bytes of a `Binary`. |
| `b.occurs_at(index, part)` | Whether the bytes of `part` occur at `index`; false where `part` does not fit. |
| `b.index_of(part, from = 0)` | The place of the first occurrence of `part`, a `Binary` or a `Byte`, at `from` or after it, or nil: `'abcabc'.binary.index_of('c'.binary, 3)` is 5. |

- `index_of` gives nil whenever `from` is past the end. An empty `part` occurs at `from` when `from` is at most the length. A negative `from` throws an `IndexError`.
- `for b in bytes` and comprehensions go through the bytes (see [for](control-flow.md#for-and-ranges)).

## Constant expressions

A **constant expression** is one of these, or an operator applied to them:

- an integer literal, of any [integer type](#sized-integers);
- a string literal that is a `String`;
- a top-level `const`, imported or not, whose value is a constant expression of the const's own type;
- `INT_MIN` and `INT_MAX`.

The operators are the arithmetic and bitwise ones of integers, prefix `-` among them, and `+` of `String`s: `SIZE := 64 * KB`, `PATH := ROOT + '/bin'`.

- A local, a parameter or a `var` is none, nor are floats so far.
- The compiler evaluates it as the program would and writes its value in its place, at no cost at run time.
- One that would throw is a compile error, wherever it is, in a function too, run or not: `INT_MAX + 1` is `integer overflow in a constant expression`, `1 / 0` and `1 << 64` are errors too, with their own messages.
  - Why: the operation throws on every run, so it is a mistake the compiler can point out at once.

## Optional values

```
var name: String?
print name ? 'nobody'
print n + 1 if n := '42'.parse_int()
```

- `T?` is a `T` or `nil`, where `T` is not itself optional. `T?` of an optional type, such as `Name?` after `type Name = String?`, is an error, since its nil would be ambiguous.
- A `T` or `nil` fits where a `T?` is expected.
- `nil` has no type of its own, so `x := nil` needs a type: `x: String? = nil`.
- An optional value can be a condition (see [control flow](control-flow.md#if-and-while)).
- An array cannot hold optional interface values yet. Other optional values are fine: `Int?[]`, `String?[]`.

### Operators

| Form | Meaning |
|---|---|
| `x!` | `x` without nil; throws `unwrapped nil` if `x` is nil. |
| `x?.name` | Optional chaining (see [below](#optional-chaining)). |
| `x ? fallback` | A fallback for nil (see [below](#fallback)). |
| `x == nil`, `x != nil` | Test for nil. |

#### Optional chaining

- The rest of the chain, the `.`, calls, indexes and `!` after it, is skipped as a whole: in `node?.name.binary.length`, a nil `node` gives nil.
- Its type is that of the chain, made optional.
- A member of the chain that may be nil takes its own `?.`: `node?.next?.name`.
- `x` is evaluated once, and must be optional.
- As a statement, `counter?.bump()` runs the chain only if `counter` is not nil.

#### Fallback

- `fallback` has the type of `x` without nil, and is evaluated only if `x` is nil.
- `?` binds tighter than comparisons, so `ages[name] ? 0 > 18` compares the age, and weaker than ranges and arithmetic.
- `a ? b ? c` is `a ? (b ? c)`.

#### Comparison

- `==` and `!=` also compare an optional value with another of its type, or with a value of its type without nil, wherever they compare the values themselves: two nils are equal, nil and a value are not, two values compare as usual.
- An expected enum reaches the other operand through the optional: `kind == '('` for a `kind: TokenKind?`.
- The ordering operators (`<` and so on) do not take optional values.

### Parsing numbers

- `s.parse_int()` gives the `Int` that a `String` of decimal digits, with an optional leading `-`, stands for; nil if it is anything else or does not fit in an `Int`.
- `s.parse_float()` gives the nearest `Float` to a decimal number with an optional leading `-`, a fraction after `.` and an exponent after `e` or `E`: `'1.5'`, `'-2'`, `'3e-4'`.
  - `'inf'` and `'-inf'`, as `to_string` writes the infinities, give them.
  - Anything else gives nil, and so does a number too large to be finite, as such a literal is an error.
  - One too small rounds to zero: `'1e-999'` gives `0.0`.

## Array

```
xs := [3, 1, 2]
names: String[]
names.push 'a'
print xs[0] + xs.length
```

- `T[]` is a growable sequence of items of type `T`, any type with values (not `void`).
- Arrays are mutable and shared: assigning or passing an array does not copy it.
- `==` and `!=` compare two arrays by their items, in order (see [equality](objects.md#equality-and-order)).

### Array literals

- `[a, b, c]` makes an array, over several lines too (see [continued lines](syntax.md#continued-lines)).
- Its item type comes from the expected type, or an optional one, if there is one: a type annotation, a parameter, a return type.
- Otherwise it comes from the first item whose type does not come from the context and that gives a value, so a `throw` does not count: `[1, c]` is a `Byte[]` when `c` is a `Byte` (see [Byte](#literals-by-context)).
- `[]` needs an expected type.
- **Spread.** An item `xs...` gives in its place the items of `xs`, anything a `for` goes through: `[first, rest..., last]`, `[header.binary..., 0x0A]`.
  - Its items count as the array's items in the rules above.
  - A spread can be an item of an array literal or an argument of a [variadic parameter](functions.md), not a comprehension's element.

### `Array(n, value)`

- It makes an array of `n` copies of `value`, of the expected item type if there is one, otherwise of the value's type: `Array(n, false)`, `row: Float[] = Array(width, 0)`.
- A negative `n` throws a `ValueError`.
- Every item is the same value, so a value that changes and is shared is an error unless it is `nil`: a class object, an array, a map, an Iter, or an interface, union or optional value that may be one, or a struct, anonymous struct or tuple that may hold one. Make each item with a comprehension instead: `[[] for _ in 0...n]`.

### Indexing

- `xs.length` is the number of items.
- `xs[i]` reads an item and `xs[i] = value` replaces one; `+=` and so on work on items of the types they take.
- An index outside `0 ... xs.length` throws `index out of range`.

#### Slices

- `xs[start...end]` copies the items from `start` up to, not including, `end` into a new array, sharing the same items.
- `xs[start..end]` includes `end`.
- It throws `slice out of range`, an `IndexError`, unless `0 <= start <= end <= xs.length`.
- A range there may leave out its start, which is then 0, or its end, which is then the length: `xs[i..]` from `i` on, `xs[...n]` the first `n`, `xs[..n]` up to `n`.
- One without an end is written `a..` alone: whether it includes its end means nothing, and `a...` before `]` would read as a [spread](#array-literals).
- A `Binary` takes such an index too.

### Methods

| Method | Does |
|---|---|
| `xs.push(item)` | Appends an item. |
| `xs.pop()` | Removes and returns the last item; throws `pop from an empty array` if empty. |
| `xs.append(ys)` | Pushes the items that `ys` has when it is called, in order, so `xs.append(xs)` doubles `xs`. |
| `xs.truncate(n)` | Removes the items after the first `n`; a negative `n` throws a `ValueError`. |
| `xs.contains(x)` | Whether an item is `==` to `x`. |
| `xs.index_of(x)` | The place of the first item `==` to `x`, or nil. |
| `xs.remove(x)` | Removes the first item `==` to `x`, moving those after it down; tells whether there was one. |
| `xs.is_empty()` | Whether there is no item, as for a map, a set, a `Binary` and a `String`. |
| `xs.first()`, `xs.last()` | The first or the last item, or nil if empty. |
| `xs.get(i)` | The item at `i`, or nil out of range, where `xs[i]` throws. |
| `xs.reversed()` | The items in the reverse order. |
| `xs.sorted(compare)` | A new array ordered by `compare`, an [`Ordering`](builtins.md#equatable-comparable-and-hashable) that is `LESS` when its first argument goes first, equal items keeping their order; without it, by the `compare` of [Comparable](builtins.md#equatable-comparable-and-hashable) items: `names.sorted()`. |
| `xs.sorted_by(key)` | Ordered as by `sorted`, by the Comparable key that `key` gives each item: `names.sorted_by((name) -> name.binary.length)`. |
| `xs.sort(compare)`, `xs.sort_by(key)` | Order the array itself as `sorted` and `sorted_by` order a copy, making no array but one copy of its items to merge into: `names.sort()`. A `compare` that throws leaves the items in some order, each once. |
| `parts.join(separator)` | A `String[]` joined into one `String`, or a `Binary[]` into one `Binary`. |
| `xs.iter()` | An [`Iter`](#iter) of the items. |

- `contains`, `index_of` and `remove` take items that `==` compares; other items are an error.
- `first`, `last` and `get` do not exist for an array of optional items, since their nil would be ambiguous.
- An array also has the lazy methods `map`, `filter`, `take` and `take_while`, and the other methods of an Iterable (see [Iter](#iter)).

## Map

```
ages := { 'ann': 31, 'bob': 27 }
squares: Map<Int, Int>
squares[3] = 9
print ages['ann'] ? 0
```

- `Map<K, V>` maps keys of type `K` to values of type `V`. Like arrays, maps are mutable and shared.
- `K` is any type of values that `==` compares, but not an optional one: classes by identity; structs, anonymous structs, tuples and arrays by their contents; a class or struct with its own equality, only with its own `hash` (see [equality](objects.md#equality-and-order)).
- `V` is any type with values, but not an optional one.

### Construction

- `{ k: v, ... }` makes a map, over several lines too, as an array.
  - Its types come from the expected type if there is one. Otherwise the key type comes from the keys and the value type from the values, each as an [array](#array-literals)'s item type does: `{ 'a': 1, 'b': 2.5 }` is a `Map<String, Float>`.
  - Of entries with the same key, the last one wins.
  - Keys that are names make an [anonymous struct](#anonymous-structs) instead, and the two kinds cannot be mixed. To use a name's value as a key, put it in parentheses: `{ (k): v }`.
- The empty map is `Map<K, V>()`, or `Map()` where a map type is expected.
- `Map(entries)` or `Map<K, V>(entries)` makes a map of the `(K, V)` [tuples](#tuples) that `entries`, anything a `for` goes through, gives: `Map([(word, word.count()) for word in words])`. Of the same key, the last wins, in the place of the first, as in a literal.

### Indexing

- `m[k]` is the value of `k`, or nil if there is none, so its type is `V?`.
- `m[k] = v` adds the key or replaces its value.
- `+=` and so on do not apply to `m[k]`, since the key may be missing.

#### Default

- `m[k, default: d]` is the value of `k`, of type `V`. Where `k` is missing, `d` is evaluated, then and only then, and the map holds it under `k` first, even where the index is only read.
  - `counts[word, default: 0] += 1` counts, and `groups[key, default: []].push(item)` groups, each array made for its own key.
  - To read a value without changing the map, write `m[k] ? d`.
- `+=` and so on read the value, or `d`, and add the key only once the result is written, so one that throws, as on overflow, leaves the map as it was.
- `m[k, default: d] = v` is an error, as the default would go unused.

- `m.length` is the number of keys.

### Methods

| Method | Does |
|---|---|
| `m.contains(k)`, `k in m` | Whether `k` is there. |
| `m.remove(k)` | Removes `k` if it is there; tells whether it was. |
| `m.entries()` | An `Iter<(K, V)>` of the keys and their values, as [tuples](#tuples): `for (key, value) in m.entries()`. |
| `m.keys()` | An `Iter<K>` of the keys; `m.keys().to_array()` gives them as an array. |
| `m.values()` | An `Iter<V>` of the values. |

- `entries`, `keys` and `values` go in the order the keys were first added; a key removed and added again counts as new.
- They give the entries there when the Iter is made: one removed before the Iter reaches it is skipped, and one added meanwhile is not given, even under a key that was there before.

## Set

```
seen: Set<String>
seen.add 'a'
primes := Set([2, 3, 5])
print 4 in primes
```

- `Set<T>` holds distinct items of type `T`, which take the rules of a [map](#map)'s keys.
- It is a map without values: it cannot be compared with `==`, nor be a map key or a set item, as a map cannot.
- It has no indexing, no literal, and none of a map's other methods, nor those of an extend of `Map<K, V>`.

### Construction

- `Set<T>()` makes an empty set, or `Set()` where a set type is expected.
- `Set(xs)` or `Set<T>(xs)` makes one of the items of `xs`, anything a `for` goes through, in order, keeping the first of equal ones.

- `s.length` is the number of items.

### Methods

| Method | Does |
|---|---|
| `s.contains(x)`, `x in s` | Whether `x` is there. |
| `s.add(x)` | Adds `x` if it is not there; tells whether it was not, so `continue if not seen.add(x)` skips what was seen. |
| `s.remove(x)` | Removes `x` if it is there; tells whether it was. |
| `a.is_subset(b)` | Whether `b` has every item of `a`. |
| `s.iter()` | An `Iter<T>` of the items there when it is made, in the order they were first added, as `m.entries()` gives a map's; `for x in s` goes through it. |

### Operators

| Operator | Items |
|---|---|
| `a \| b` | Those of either. |
| `a & b` | Those of both. |
| `a - b` | Those of `a` that `b` has not. |
| `a ^ b` | Those of one that the other has not. |

- Each gives a new set, in the order of `a`, followed by the items taken from `b` in its order (see [operators](objects.md#operators)).
- `a |= b` and the like replace `a`.

## Iter

```
squares := (x * x for x in 0...10 when x % 2 == 0)
print square for square in squares.take(3)
shouts := ['hi', 'yo'].map((w) -> w + '!').to_array()
```

- `Iter<T>` is a lazy sequence of items of type `T`, any type with values, an optional one too.
- It computes an item only when asked for it, so nothing happens until it is consumed. A statement that only makes an `Iter` is an error (see [discarded values](errors.md#discarded-values)).
- [Lazy comprehensions](control-flow.md#for-and-ranges), [functions that yield](functions.md#functions-that-yield) and the lazy methods below make one.
- `it.has_next()` tells whether there is an item left, and `it.next()` gives it; past the end, `next` throws `next past the end of an Iter`.
- `it.iter()` gives the `Iter` itself, so that it is [Iterable](builtins.md#iterable).

### Lazy methods

These methods of an array, a `Binary`, an `Iter` or any [Iterable](builtins.md#iterable) give an `Iter`:

| Method | Items |
|---|---|
| `xs.map(f)` | `f(x)` for each item `x`, of the type of `f`'s result. |
| `xs.filter(f)` | The items for which `f`, which gives a `Bool`, is true. |
| `xs.take(n)` | The first `n` items, or all if there are fewer; none if `n` is not positive. |
| `xs.take_while(f)` | The items before the first for which `f`, which gives a `Bool`, is false; it reads that item and none after it. |
| `xs.zip(ys)` | The items of `xs` and of the Iterable `ys` in pairs, as [tuples](#tuples): `for (name, count) in names.zip(counts)`. |

- `zip` throws `zip of Iterables of different lengths` once one has no more items and the other has, so a missing item is not dropped silently. To pair an array `xs` with the first items of a longer `ys`, write `xs.zip(ys.take(xs.length))`.
- The `Iter` of an array reads the array as it goes, as a `for` does.
- The functions' parameter types may be left out: `(w) -> w + '!'`.

### Consuming methods

These methods of an Iterable go through its items and give a result:

| Method | Gives |
|---|---|
| `xs.any(f)` | Whether `f` is true for some item. |
| `xs.all(f)` | Whether `f` is true for every item; true for no items. |
| `xs.find(f)` | The first item for which `f` is true, or nil. |
| `xs.find_index(f)` | The place, from 0, of the first item for which `f` is true, or nil. |
| `xs.find_map(f)` | The first result of `f`, which gives an optional value, that is not nil, or nil: `lines.find_map((line) -> line.without_prefix('name: '))`. |
| `xs.sum(zero = 0)` | The items added to `zero` one after another. |
| `xs.min()`, `xs.max()` | The least or the greatest item, of [Comparable](builtins.md#equatable-comparable-and-hashable) items. |
| `xs.min_by(key)`, `xs.max_by(key)` | The item whose Comparable `key(x)` is the least or the greatest. |
| `xs.count()` | The number of items. |
| `xs.fold(initial, combine)` | `combine` applied to `initial` and the first item, then to that and the next, and so on; `initial` if there are none: `[3, 1, 2].fold(0, (sum, x) -> sum * 10 + x)` is 312. |
| `xs.to_array()` | The items as an array, of a `T` an array can hold. |

- `any`, `all`, `find`, `find_index` and `find_map` stop reading at the first item that decides the result; `f` of the first four gives a `Bool`.
- `find`, `min`, `max`, `min_by` and `max_by` give a `T?`, so for items of an optional type they are an error (see [optional values](#optional-values)). The last four give the first of equal items, and nil for no items.
- `sum` takes items whose `+` gives their own type ([`Add<T, T>`](builtins.md#operators)): `[1, 2, 3].sum()` is 6, `[0.5, 1.0].sum()` 1.5. Items of other types give their zero, as 0 is none of theirs: `['a', 'b'].sum('')` (see [defaults](functions.md)). It throws as `+` does, so `integer overflow` for a sum beyond its type.
- `count` counts as `for` goes through the items:
  - of a `String`, its `Char`s, which no `length` gives: `'héllo'.count()` is 5. These are code points, not what a reader takes for one character: `'e\u{301}'.count()` is 2.
  - of an array, as many as its `length`, which gives the number without going through the items.

### Traversing once

- **An `Iter` can be traversed only once.** `has_next` and `next` traverse it, and so does each consumer:
  - `for`, and a comprehension over it;
  - the consuming methods above;
  - the lazy methods, whose `Iter` reads it.
- A consumer throws `an Iter can be traversed only once` if a traversal has started. To go through the items several times, keep them with `to_array()`.

### Iters written in Lerta

A value of a type with `has_next(): Bool` and `next(): T` converts to an `Iter<T>` where one is expected, as a value converts to an [interface type](objects.md#interfaces), so it must be a reference. The `Iter` gives the items that its `has_next` and `next` give. The state is typically a `var` that the two functions capture:

```
countdown := (n: Int): Iter<Int> ->
  var i = n
  has_next := -> i > 0
  next := ->
    i -= 1
    i + 1
  { has_next, next }
```

- Why a conversion into the builtin `Iter<T>`, rather than `Iter<T>` as an interface: the rule that an `Iter` can be traversed only once then holds for every `Iter`.

### Why

- Lazy: an `Iter` is not evaluated until consumed, the Rust approach, which avoids CoffeeScript's implicit arrays and the intermediate arrays of an eager `map` in Ruby and JS.
- `has_next()` / `next()` rather than `next(): T?`: with the latter, the end could not be told apart when `T` is optional.
- A second traversal throws rather than silently giving nothing, as a Python generator does.

## Promise

- `Promise<T>` is the result of a [function that awaits](functions.md#functions-that-await). Once settled, it holds a value of type `T` or an exception, which `await` gives or throws.
- A `Promise` without a type argument holds no value, as `void` is no type of values.
- Its methods are `is_settled` and `cancel` (see [builtins](builtins.md#promise)). It cannot be compared, printed or a member of a union.

## Unions

```
type Expr = Num | Add | Mul
```

- `A | B` is a value of any of the member types.
- A discriminated union needs no tag: the member's type itself tells the members apart, with no `kind` field or enum. Branch with `is` or `case`.

### Aliases

- `type Name = ...` names a type at the top level.
- An alias may refer to types and aliases declared later, but not to itself.
- After a `=` that ends the line, the indented lines below are the members of a union, one or more on each line:
  ```
  type Shape =
    Circle | Ellipse | Square | Rectangle | Triangle | Pentagon | Hexagon | Polygon | Star | Arrow
    SpeechBubble
  ```

### Members

- A member is, so far, one of: classes and structs, arrays, maps, tuples, anonymous structs, interfaces, the numbers, `Bool`, `String`, `Binary` and enums. Examples: `Int | String`, `Byte[] | String`, `Byte[] | Writer`, `(Int, String) | Int`.
- A union holds one array type and one map type at most: `Int[] | String[]` is an error, `a union holds one array type and one map type at most, which it tells apart so far`.
- A function type cannot be a member: `a union cannot hold a function type`.
- An optional member, as `String?` in `Int | String?` (`?` binds tighter than `|`), makes nil a value of the union, which is then optional.
- A member that is itself a union is flattened, and a member written twice counts once: `Int | Int` is an `Int`.
- The order of the members does not matter.

### Values

- A member's value fits where the union is expected.
- So does a value of a type that is no member but satisfies an interface member: it is converted to that interface, as where one is expected (see [interfaces](objects.md#interfaces)). A `Socket` fits where a `Byte[] | Writer` is.
  - Such a value is not optional nor a union itself, as for any conversion to an interface: an `S | Int` does not convert to an `A | Int` so far.
  - A type that satisfies two interface members is an error there: `S satisfies A and B, members of A | B, so the union cannot tell which it is; convert it to one of them first`.
  - A value of a member stays that member, even if it satisfies an interface member too.
- A union with an interface member cannot be compared with `==`, as an interface value cannot.

### Shared fields and methods

- A field that every member, a class or a struct, declares with the same type can be read from the union: `shape.name` reads the field of whichever member the value is, and `shape.area()` calls a field that holds a function.
- It can be assigned through the union, `shape.name = n` (and `+=` and so on), when every member is a class whose field is not `const`.
- A method that every member has, of the same type in each, can be called on the union, with all its arguments, unless it is generic, of a generic type, or of an extend of an interface. `value.to_string()` calls the method of whichever member the value is, so `print` and `"#{value}"` take a union of `Stringable` types.
- Other fields and methods cannot be used directly: branch on the type first.

### `is` and `as`

| Form | Gives |
|---|---|
| `x is T` | Whether a union value holds a `T`; for an optional union value, whether it is not nil and holds a `T`. |
| `x is not T` | `not (x is T)`. |
| `x as T?` | The value as a `T` if it holds one, otherwise nil; nil for nil. |
| `x as T ? y` | `(x as T?) ? y`, with a space before `?`: the value as a `T`, or `y`, evaluated only then. |
| `x as T!` | The value as a `T`; throws `failed cast` otherwise. |

- `x as T` alone is an error, so that a cast shows where it is written whether it fails into nil, falls back or throws.
- `x as T ? y` binds as the fallback of `?` does (see [optional values](#optional-values)), and `y` may be another such cast: `x as T ? y as T ? z` is `x as T ? (y as T ? z)`.
- `is` narrows as nil tests do: a `const`, a parameter, a loop variable or a path of fields from one, to `T` where it holds and to the other members where it does not (see [narrowing](control-flow.md#narrowing)). To take a narrowed value under another name, write `if c := x as Circle?`.
- `is` and `as` are not [keywords](syntax.md#contextual-words), and do not chain with comparisons.
- There is no unchecked cast.

#### What `T` may be

- In `x is T`: any member, as `x is Int[]`, `x is (Int, String)` or `x is { x: Int }`.
- In `x as T?` and `x as T!`: a named type or an array of one, as `x as Int[]!`.
- In the patterns of a `case`: a named type.
- In each, also a type alias of a union of some of the members: `x is T` then tells whether `x` holds one of them.
- For a narrowed local, any member of the type it was declared with.

## Enums

```
enum TokenKind
  IDENTIFIER
  INTEGER
  '('
  '->'

kind: TokenKind = INTEGER
first := TokenKind.IDENTIFIER
print kind == first
print kind == '('
```

### Declaration

- `enum Name` declares, at the top level, a type whose values are its members, listed one per line in the indented block below: at least one.
- A member is a name, `INTEGER`, or a string literal without interpolation, `'('`.
- Its text is the name, or the literal's value. No two members have the same text, so `IDENTIFIER` and `'IDENTIFIER'` cannot both be members.
- A name member cannot be `parse`, which `Name.parse` takes; `'parse'` can.
- The members carry no data.

### Naming a member

- `Name.MEMBER` names a member by its name.
- Where an enum is expected, a member stands alone, in its one spelling: its name, `INTEGER` above, or, for a member declared as a string literal, that literal, `'('`.
- An enum is expected wherever an expected type reaches a literal (see [Byte](#literals-by-context)), and also:
  - in the other operand of `==` and `!=`;
  - in the items of an array literal after `in`: `kind in ['(', '->']`;
  - in the patterns of a [`case`](control-flow.md#case-with-a-subject) on an enum.
- A string literal there that is no such member is an error, `'INTEGER'` included. Where no enum is expected, it is a `String`.
- A member name alone cannot take the place of another name in scope, such as a local, a function or an import of the same name; it must be qualified there.
- Without an expected enum, a member name alone is an undefined name.

### Comparison and text

- `==` and `!=` compare two values of the same enum. There is no ordering.
- An enum can be a [`Map`](#map) key.
- It is `Stringable`: `kind.to_string()` gives the member's text, `'INTEGER'` or `'('`.
- `Name.parse(text)` gives the member whose text is the `String` `text`, or `nil`. It must be called.

## Anonymous structs

```
divide := (a: Int, b: Int): { quotient: Int, remainder: Int } ->
  { quotient: a / b, remainder: a % b }
{ quotient, remainder } := divide(17, 5)
```

- `{ x: 1, y: 'a' }` is a value of the anonymous struct type `{ x: Int, y: String }`.
- `{ x, y }` is short for `{ x: x, y: y }`.
- Where an anonymous struct type, or an optional one, is expected, each field the type has takes its type from it. The others, and all fields elsewhere, take the types of their values.
- A field cannot be nil alone.
- `?` after the type makes it optional: `{ a: Int }?`.
- Two anonymous struct types are the same if their fields have the same names and types, in any order. An anonymous struct is a different type from any class or struct.
- Its fields are read with `.` and cannot be changed. It is useful to return several values.

### Spread

- A spread first, `{ r..., z: 3 }`, gives the fields of the anonymous struct `r`, but for those written after it: a new anonymous struct, whose fields written may have other types than those of `r`.
- The spread is of a name, `@` or a path of fields from one, which the fields are read from where it is. It is the only one, before the fields.

### Constructing a struct

- Where a struct, or an optional one, is expected, `{ x: 1 }` constructs that struct, as `Point(x: 1)` does with the same fields as named arguments (see [construction](objects.md#construction)): `points: Point[] = [{ x: 1 }, { x: 2, y: 3 }]`.
- `{ p..., x: 1 }` there constructs it from `p`, as `Point(p..., x: 1)` does.
- The type arguments of a generic struct come from the expected type.
- It does not construct a class, nor a struct that a union or an interface is expected to hold.

### As arguments

- When the last parameter of a call is of an anonymous struct type, its argument may be given as named arguments without `{}`, as for a [struct](functions.md): `draw('a', x: 1, y: 2)` is `draw('a', { x: 1, y: 2 })`.
- Named arguments come after the others, as in the construction of a class or struct.

### Destructuring

- `{ a, b } := value`, or `var { a, b } = value`, declares `a` and `b` from the fields of those names of an anonymous struct, a class or a struct.
- The value is evaluated once.
- It must be on a line of its own.

## Tuples

```
swap := (t: (String, Int)) ->
  (s, n) := t
  (n, s)
```

- `(1, 'a')` is a value of the tuple type `(Int, String)`, of two or more items. `(a)` is only parentheses.
- Where a tuple type of as many items, or an optional one, is expected, each item takes its type from it; elsewhere, the types of their values.
- An item cannot be nil alone.
- `?` after the type makes it optional: `(Int, String)?`.
- Two tuple types are the same if their items have the same types in the same order.

### Destructuring

- Items cannot be read by position: `(a, b) := value`, or `var (a, b) = value`, takes the tuple apart, declaring a name for each item, so that each gets a name where it is used.
- The value must be a tuple of as many items. It is evaluated once.
- `_` discards an item.
- It must be on a line of its own.
- A loop takes items apart too (see [for](control-flow.md#for-and-ranges)).

### Why

- Tuples beside [anonymous structs](#anonymous-structs): a tuple's items are named by the code that uses it, as fits what `zip` gives; an anonymous struct's fields by the code that makes it, as for the several results of a function.
