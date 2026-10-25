# Types

Type names: `Int`, `Byte`, `Float`, `Float32`, `Bool`, `String`, `Binary`, `T[]`, `Map<K, V>`, `Iter<T>`, `Promise<T>` and `Promise`, `T?`, unions `A | B`, function types, anonymous struct types such as `{ x: Int }`, tuple types such as `(Int, String)`, the names of classes, structs, enums, interfaces and `type` aliases, `Self` in an [interface](objects.md#interfaces) or an extend of one, the type parameters of a generic function or extend in it, and `void` and `never` as a return type. How they are written is in [the syntax](syntax.md#calls).

The methods of the builtin types are listed in [builtins](builtins.md#methods-of-the-builtin-types). Methods can only be called (see [function values](functions.md#function-values)).

## Int

- `Int` is a signed 64-bit integer.
- A literal must fit in `Int`, including its sign (`-9223372036854775808`, or `-0x8000000000000000`, is the minimum).
- Comparisons (`==` `!=` `<` `<=` `>` `>=`) between `Int`s give a `Bool`.
- `+` `-` `*` and prefix `-` throw `integer overflow` when the result does not fit.
- `/` is the quotient, truncated toward zero, and `%` is the remainder (`-7 / 2 == -3`, `-7 % 2 == -1`). Both throw `division by zero` when the divisor is 0, and `integer overflow` for the minimum value divided by `-1`.
- `&` `|` `^` are bitwise and, or and exclusive or, and `x ^ -1` inverts the bits. `x << n` throws `integer overflow` unless the result fits, as `x * 2` to the `n` would, so that it never changes the sign, and `x >> n` shifts in copies of the sign bit. A shift throws `shift out of range` when `n` is negative or 64 or more.
- `n.to_hex(width = 0)` gives `n` in lower-case hexadecimal, with zeros before it to make `width` digits: `255.to_hex()` is `'ff'`, `10.to_hex(4)` is `'000a'`, and `.to_upper()` gives the upper case. A negative `n` throws a `ValueError`, as it has no one such text.
- `x.wrapping_add(y)`, `wrapping_sub` and `wrapping_mul` do the same without the check, wrapping around modulo 2 to the 64, for hashes and checksums.
- Why one name each for `Int` and `Byte`, rather than also `Int64` and `UInt8`: the common types have no second name to choose between. Why the arithmetic of every integer type throws on overflow, an unsigned one too: a size that goes below 0 would otherwise be a large number, silently; a computation that means to wrap around says so with a method, so that an arithmetic operator has one rule for every type. A bitwise operator works on bits, and `<<` of an unsigned type drops those shifted out; that of a signed type checks, as it would change the sign.

## Byte

- `Byte` is an unsigned 8-bit integer.
- `+` `-` `*` throw `integer overflow` when the result is not from 0 to 255, as `250 + 10` and `1 - 2` are not; there is no prefix `-`, which would throw for all but 0; `wrapping_add`, `wrapping_sub` and `wrapping_mul` wrap around modulo 256, `250.wrapping_add(10)` being `4`. `/` and `%` throw `division by zero` when the divisor is 0. Comparisons treat values as unsigned. `&` `|` `^` are bitwise, `b << n` drops the bits shifted out and `b >> n` shifts in zeros; a shift throws `shift out of range` when `n` is 8 or more.
- There are no implicit conversions: `Byte` and `Int` cannot be mixed in one operation. `b.to_int()` converts a `Byte` to an `Int`, and `n.to_byte()` an `Int` to a `Byte?`, nil unless it is from 0 to 255: `n.to_byte() ? 0`, or `n.to_byte()!` where it must fit (see [conversions](#sized-integers)).
- `b.is_digit()`, `b.is_letter()` and `b.is_space()` tell whether it is an ASCII digit, letter (`a` to `z`, `A` to `Z`) or space (a space, `\t`, `\n` or `\r`). `b.is_utf8_continuation()` tells whether it continues a UTF-8 sequence (0x80 to 0xBF), as when counting the code points of a `Binary`. `b.hex_value()` gives the value of a hexadecimal digit of either case, from 0 to 15, or nil if `b` is none.
- **The type of a literal is decided by context.** Where a `Byte` or a `Byte?` is expected, an integer literal from 0 to 255 is a `Byte`, and so is a string literal of one byte (`'a'`). The expected type reaches literals inside arithmetic (`c == 1 + 2`), `case` arms, array items and return values. An operand of `+`, `==`, `<` and so on whose type comes from the context is expected to have the type of the other operand, so `c >= '0'` and `'0' <= c` compare two `Byte`s when `c` is one; likewise `[1, c]` is a `Byte[]`. Without such a context, `'a'` is a `String` and `1` an `Int`.

## Sized integers

```
flags: UInt16 = 0x8001
offset: Int32 = -4
print (flags >> 15).to_int() + offset.to_int()
```

- `Int8`, `Int16` and `Int32` are signed integers of 8, 16 and 32 bits, and `UInt16`, `UInt32` and `UInt64` unsigned ones of 16, 32 and 64 bits; `Byte` is the unsigned one of 8 bits and `Int` the signed one of 64, with no second names.
- Each takes the rules of `Int` if it is signed and those of `Byte` if it is unsigned: `+` `-` `*` throw `integer overflow` when the result does not fit, `/` and `%` throw `division by zero`, and the least value of a signed type divided by `-1` overflows; comparisons follow the sign; prefix `-` is for the signed ones; `&` `|` `^` `<<` `>>` work by the type's bits, a shift throwing `shift out of range` from the bits up, and `<<` of a signed type checked as that of `Int` is; `wrapping_add`, `wrapping_sub` and `wrapping_mul` wrap around modulo 2 to the bits.
- An integer literal is of the integer type that is expected, and must fit in it; elsewhere it is an `Int`. A `UInt64` literal cannot be above the largest `Int` so far.
- There are no implicit conversions between integer types. `x.to_int()`, `x.to_byte()`, `x.to_int8()`, `x.to_int16()`, `x.to_int32()`, `x.to_uint16()`, `x.to_uint32()` and `x.to_uint64()` convert a value of any integer type to that type. Where every value of the type converted fits there, as every `Byte` fits in an `Int`, the result is of that type; otherwise it is optional, nil for a value that does not fit, as a negative value fits in no unsigned type: `x.to_int()` of a `UInt64` is an `Int?`. A type holds every value of another where it has no fewer bits and the same sign, or more bits than an unsigned one. `x.to_float()` gives the nearest `Float`. `x.to_string()` gives the decimal digits, with a `-` for a negative value.
- Why conversions give nil rather than throw: whether a value fits is often a question about input, which the caller answers with `? return`, a fallback or a message of its own, and a caller that knows it fits says so with `!`; a check before the conversion would repeat the conversion's own. Arithmetic still throws, as an overflow there is a bug rather than a question.
- They compare with `==`, are map keys and set items, are written by an array's `to_string`, and are patterns of a `case`; arrays and maps hold each at its own size. A C function may take and give them as the C types of their bits and sign, as `int32_t`.

## Char

```
kana := (c: Char) -> c >= 'ぁ' and c <= 'ゖ' then c + 0x60 else c
print [kana(c).to_string() for c in 'ひらがな'].join('')
```

- `Char` is a Unicode scalar value: a code point from 0 to 0x10FFFF, but for the surrogates, 0xD800 to 0xDFFF. A `String` gives its code points as `Char`s (see [String](#string)).
- Where a `Char` or a `Char?` is expected, a string literal of one code point is that `Char`, `c == 'é'`, and one of no code point or of more is an error, as `'é'` written as an `e` and a combining accent is. An integer literal is no `Char`. Where a union with a `String` member is expected, a string literal is the `String`.
- `c.to_string()`, which `print` and interpolation use, gives the `String` of the one code point. `c.to_int()` gives its number, and `n.to_char()` of any integer type gives the `Char` of a number, as a `Char?`, nil for a number that is none, but for a `Byte`, which is always one.
- `c + n` and `c - n`, with `n` an `Int`, give the `Char` `n` places on or back, throwing a `ValueError`, `not a Unicode scalar value`, where there is none, as the surrogates or beyond 0x10FFFF, and `integer overflow` where the number would not fit in an `Int`. They are the methods `add` and `sub` of `Char`, which an operator calls as it does those of any type (see [operators](objects.md#classes-and-structs)), so a string literal on the left is a `String`, as nothing expects a `Char` there: write `c + 1` of a `Char` `c`, not `'a' + 1`. There is no other arithmetic; the distance between two `Char`s is `c.to_int() - d.to_int()`.
- `Char`s compare with `==` and order with `<` and the like by their numbers, and are map keys, set items, patterns of a `case`, items of arrays and members of unions. A `Char` is not compared with an integer, nor mixed with one in another operation but for `+` and `-` with an `Int` on the right. `std:json` does not convert `Char`s so far.
- `c.is_digit()`, `c.is_letter()` and `c.is_space()` tell what those of a `Byte` tell, and so are true only for ASCII characters: `'０'`, `'é'` and U+3000 are in no class.
- Why a type of its own rather than an alias of `UInt32`: a `Char`'s text is the character, not its number, and every `Char` is a scalar value, so that `to_string` cannot fail; arithmetic on code points is moving through them, which `+` and `-` of an `Int` give.
- Why not graphemes: a `Char` is what UTF-8 encodes one at a time, as Rust's `char` is, while a grapheme, what is seen as one character, may be several (see [String](#string)).

## Float

- `Float` is a 64-bit IEEE 754 double that is always finite: no `Float` is an infinity or NaN. An operation whose result would be one throws instead, so `==` holds for every value and its own copy, and `<` orders all values.
- A literal has a fraction or an exponent, or both (`1.5`, `1e9`, `2.5e-3`; see [syntax](syntax.md)), and rounds to the nearest double. One too large to be finite is an error. **Where a `Float` or a `Float?` is expected, an integer literal is a `Float` too** (`x: Float = 3`), as it becomes a `Byte` where one is expected (below), and a decimal one may then be beyond `Int`, rounding as a float literal does (`x: Float = 18446744073709551616`). A hexadecimal one may not, as it stands for the bits of an `Int`.
- `+` `-` `*` `/` and prefix `-` follow IEEE 754. `/` throws `division by zero` when the divisor is 0, and the others `float overflow` when the result is too large to be finite. There is no `%`.
- Comparisons and `==` follow IEEE 754 too: `-0.0 == 0.0`, and a map whose keys are `Float`s, or a set of them, holds them as one key, `0.0`. `0.1 + 0.2 == 0.3` is false, as the doubles nearest these values do not add up exactly.
- `case` cannot branch on a `Float`, as an exact value of a `Float` is rarely what a branch means.
- There are no implicit conversions: `Float` and `Int` cannot be mixed in one operation. `n.to_float()` gives the nearest `Float` to an `Int`, and `x.to_int()` the `Int` of a `Float` truncated toward zero, as an `Int?`, nil unless it fits.
- `x.to_string()`, which `print` and interpolation use, gives the fewest digits that read back as the value: positional from `1e-4` up to `1e16`, with `.0` for a whole number (`1.0`, `0.30000000000000004`, `-0.0`), and scientific beyond (`1e+16`, `5e-324`), as Python writes them.
- `x.to_fixed(digits)` gives `x` with `digits` digits after the point, from 0 to 18, and no point for 0: `3.14159.to_fixed(2)` is `'3.14'`, `2.5.to_fixed(0)` is `'3'`. It rounds `x` times 10 to the `digits` half away from zero to an `Int`, throwing `integer overflow` unless it fits, and `digits` outside the range throws a `ValueError`. The product is a `Float`, which may round, so a value just below a half, as the double nearest `1.005`, may round up; a negative value that rounds to 0 has no `-`.
- Why no infinity and no NaN: a NaN goes on silently through arithmetic until a comparison much later gives a wrong answer, and makes `==` fail for a value and itself; an operation that has no finite result is an error as `Int` overflow is. Whether to allow infinities later is an [open question](../roadmap/language.md#open-questions); allowing them would break no program, while taking them away would.

## Float32

- `Float32` is a 32-bit IEEE 754 float, finite as `Float` is: its operations are in 32 bits and throw where the result would not be finite, it compares, is a map key and a set item, and is written by an array's `to_string`, and `case` cannot branch on it. It does not mix with `Float` in one operation.
- Where a `Float32` or a `Float32?` is expected, a float literal, or an integer one, is a `Float32`: it rounds to the nearest `Float32` at once, and one too large to be finite as a `Float32` is an error.
- `x.to_float32()` gives the nearest `Float32` to a `Float`, as a `Float32?`, nil unless it is finite as a `Float32`, and `x.to_float()` the `Float` of a `Float32`, exactly. `x.to_string()` gives the fewest digits that read back as the `Float32`, written as a `Float`'s are: `0.1`, `0.33333334`, `3.4028235e+38`.
- A C function takes and gives a `Float32` as a `float`.

## Bool

- `Bool` has the values `true` and `false`.
- `==` and `!=` compare two `Bool`s. There is no ordering (`<` and so on).

## String

- A `String` is immutable text in UTF-8.
- `+` concatenates two `String`s into a new one, and `s + c` of a [Char](#char) `c` appends its UTF-8: a string literal there is a `String`, as `+` expects one. `+=` appends to a variable.
  - `+=` appends in place to a `String` that nothing else holds, so that a loop of `+=` is O(n) in all. One that something else holds, as another variable, an array, a closure or a `for` going through it, is copied first, once: the copy is held by the variable alone. A loop that shares the `String` again at each step, as one that pushes it onto an array before each `+=`, copies it each time, which is O(n²).
- `s.split(separator)` gives the pieces of `s` between the occurrences of `separator`, in a `String[]`, empty pieces too: `'a,,b'.split(',')` is `['a', '', 'b']`, and `''.split(',')` is `['']`. An empty separator throws a `ValueError`, `split by an empty separator`.
- `s.starts_with(prefix)` tells whether `s` begins with the bytes of `prefix`, and `s.ends_with(suffix)` whether it ends with those of `suffix`.
- `s.without_prefix(prefix)` gives what follows `prefix` in `s`, or nil if `s` does not begin with it: `'std:io'.without_prefix('std:')` is `'io'`. `s.without_suffix(suffix)` gives what comes before `suffix`, or nil.
- `s.contains(part)` tells whether the bytes of `part` occur in `s`. `s.split_once(separator)` gives what comes before the first occurrence of `separator` and what comes after it, as a `(String, String)`, or nil if there is none: `'k = v = w'.split_once(' = ')` is `('k', 'v = w')`. `s.replace(part, by)` gives `s` with each occurrence of `part`, from the start and without overlapping, replaced by `by`. `s.trim()` drops the whitespace at both ends, the ASCII spaces, tabs, carriage returns and newlines, and `s.trim_start()` and `s.trim_end()` drop it at the start or the end only. `s.repeat(n)` gives `n` copies of `s` one after another. `s.pad_start(width, fill = ' ')` gives `s` after as many copies of `fill`, one code point, as make it `width` code points long, or `s` itself if it is no shorter (`'7'.pad_start(3, '0')` is `'007'`), and `s.pad_end(width, fill = ' ')` with them after it; a fill of more or fewer code points throws a `ValueError`, even where none would be added. `s.to_upper()` and `s.to_lower()` change the case of the ASCII letters, `a` to `z` and `A` to `Z`, and leave every other character as it is: `'café'.to_upper()` is `'CAFé'`. `split_once` with an empty `separator` and `replace` with an empty `part` throw a `ValueError`, as `split` does, and so does `repeat` with a negative `n`; every `String` contains the empty one.
- `a.compare(b)` is `LESS`, `EQUAL` or `GREATER` as `a` goes before, with or after `b` in the order of their bytes, which does not depend on a locale: a prefix goes first. `<`, `<=`, `>` and `>=` order two `String`s so.
- `==` and `!=` compare two `String`s byte by byte.
- A `String` is [Iterable](builtins.md#iterable): `for c in s`, comprehensions and `s.iter()` give its code points, as [Char](#char)s, in order, so `'é'` gives the `Char` of 233; its bytes are `s.binary`.
- Why code points rather than bytes or graphemes: a `Binary` already gives the bytes, and code points are what UTF-8 encodes, while graphemes need Unicode's tables.
- Why UTF-8: a PEP 393 style variable-width representation was considered, but it costs a conversion at every I/O boundary. There is no integer indexing `s[i]`, which could be taken for a character, and no StringBuilder, since `+=` appends in place to a `String` that nothing else holds, so that a loop of `+=` is O(n) in all (see [internals](../internals.md#strings)).

## Binary

- `Binary` is an immutable sequence of bytes; a mutable one is a `Byte[]`. `s.binary` gives the bytes of a `String` (its UTF-8 encoding) without copying them; `b.text()` goes back (see below).
- `b.length` is the number of bytes, and `b[i]` is the byte at `i`, a `Byte`; an index outside `0 ... b.length` throws `index out of range`.
- `==` and `!=` compare two `Binary`s byte by byte.
- `+` joins two `Binary`s into a new one, `b + byte` appends a `Byte`, and `+=` appends to a variable, as they do to `String`s; an integer literal there is no `Byte`, as `+` expects a `Binary`. A `String` and a `Binary` are not joined (`cannot join a String and a Binary`): `s.binary` gives the bytes of the `String` without copying them. `parts.join(separator)` joins a `Binary[]` into one `Binary`; pieces gathered so and joined once are O(n), as for `String`s.
- `b.occurs_at(index, part)` tells whether the bytes of `part` occur in `b` at `index`; it is false where `part` does not fit.
- `b.index_of(part, from = 0)` gives the place of the first occurrence of `part`, a `Binary` or a `Byte`, at `from` or after it, or nil if there is none, which is the case whenever `from` is past the end: `'abcabc'.binary.index_of('c'.binary, 3)` is 5. An empty `part` occurs at `from` when `from` is at most the length. A negative `from` throws an `IndexError`.
- `for b in bytes` goes through the bytes (see [for](control-flow.md#for-and-ranges)), as comprehensions over a `Binary` do.
- `bytes.to_binary()` copies the items of a `Byte[]` into a new `Binary`.
- `b[start...end]` copies the bytes from `start` up to, but not including, `end` into a new `Binary`; it throws `slice out of range` unless `0 <= start <= end <= b.length`. Only a `Binary` takes a range as its index.
- Why `Binary` is separate from `String`: a `String` only adds the invariant "valid UTF-8", rather than "a string is any byte sequence" as in Python 2 and Go.
- `b.text(start, end)` gives the bytes from `start` up to `end` as a `String` if they are valid UTF-8, or nil otherwise; it throws an `IndexError` if they are out of range. `start` is 0 and `end` is `b.length` by default, and `b.text()` gives the whole `Binary` without copying its bytes. `b.text()!` or `b.text() ? throw ...` takes a String where the bytes must be UTF-8.

## Optional values

```
var name: String?
print name ? 'nobody'
print n + 1 if n := '42'.parse_int()
```

- `T?` is a `T` or `nil`, where `T` is not itself optional: `T?` of an optional type, such as `Name?` after `type Name = String?`, is an error, since its nil would be ambiguous. A `T` or `nil` fits where a `T?` is expected. `nil` has no type of its own, so `x := nil` needs a type (`x: String? = nil`).
- `x!` is `x` without nil; it throws `unwrapped nil` if `x` is nil.
- `x?.name` is nil if `x` is nil, and otherwise `x.name` followed by the rest of the chain of `.`, calls, indexes and `!` after it, which is skipped as a whole: in `node?.name.binary.length`, a nil `node` gives nil. Its type is that of the chain, made optional. A member of the chain that may be nil takes its own `?.`: `node?.next?.name`. `x` is evaluated once, and must be optional. As a statement, `counter?.bump()` runs the chain only if `counter` is not nil.
- `x ? fallback` is `x` without nil, or `fallback`, which has that type, if `x` is nil. The fallback is evaluated only then. `?` binds tighter than comparisons, so `ages[name] ? 0 > 18` compares the age, and weaker than ranges and arithmetic; `a ? b ? c` is `a ? (b ? c)`.
- `x == nil` and `x != nil` test an optional value. `==` and `!=` also compare an optional value with another of its type, or with a value of its type without nil, wherever they compare the values themselves: two nils are equal, nil and a value are not, and two values compare as usual. An expected enum reaches the other operand through the optional (`kind == '('` for a `kind: TokenKind?`). The ordering operators (`<` and so on) do not take optional values.
- An optional value can be a condition (see [control flow](control-flow.md#if-and-while)).
- An array cannot hold optional `Int`, `Byte`, `Float` or `Bool` values yet; optional references are fine (`String?[]`).
- `s.parse_int()` gives the `Int` that a `String` of decimal digits, with an optional leading `-`, stands for, or nil if it is anything else or does not fit in an `Int`. `s.parse_float()` gives the nearest `Float` to a decimal number, with an optional leading `-`, a fraction after `.` and an exponent after `e` or `E` (`'1.5'`, `'-2'`, `'3e-4'`), or nil if it is anything else or too large to be finite; one too small rounds to zero (`'1e-999'` gives `0.0`).

## Array

```
xs := [3, 1, 2]
names: String[] = []
names.push 'a'
print xs[0] + xs.length
```

- `T[]` is a growable sequence of items of type `T`, which can be any type with values (not `void`). Arrays are mutable and shared: assigning or passing an array does not copy it.
- `[a, b, c]` makes an array (over several lines too: see [lines inside brackets](syntax.md#lines-inside-brackets)). Its item type comes from the expected type if there is one (a type annotation, a parameter, a return type), otherwise from the first item whose type does not come from the context and that gives a value, so a `throw` does not count, and `[1, c]` is a `Byte[]` when `c` is a `Byte` (see [Byte](#byte)). `[]` needs an expected type.
- `Array(n, value)` makes an array of `n` copies of `value`, of the expected item type if there is one, otherwise of the value's type: `Array(n, false)`, `row: Float[] = Array(width, 0)`; a negative `n` throws a `ValueError`. Every item is the same value, so a value that changes and is shared, a class object, an array, a map, an Iter, or an interface, union or optional value that may be one, or a struct, anonymous struct or tuple that may hold one, is an error unless it is `nil`: make each item with a comprehension, `[[] for _ in 0...n]`.
- **Spread.** An item `xs...` gives the items of `xs`, anything a `for` goes through, in its place: `[first, rest..., last]`, `[header.binary..., 0x0A]`. Its items count as the array's items in the rules above. A spread can be an item of an array literal or an argument of a [variadic parameter](functions.md), not a comprehension's element.
- `xs[i]` reads an item and `xs[i] = value` replaces one (`+=` and so on work on `Int` items). An index outside `0 ... xs.length` throws `index out of range`.
- `xs.length` is the number of items.
- `==` and `!=` compare two arrays by their items, in order (see [equality](objects.md#classes-and-structs)).
- `xs.push(item)` appends an item. `xs.pop()` removes and returns the last one; on an empty array it throws `pop from an empty array`. `xs.contains(x)` tells whether an item is `==` to `x`, for items that `==` compares (other items are an error), and `xs.find_index(f)` gives the place of the first item for which `f` is true, or nil, and `xs.index_of(x)` that of the first item `==` to `x`, for the same items as `contains`. `xs.is_empty()` tells whether the array has no item, as it does for a map, a set, a `Binary` and a `String`, which has no `length` (see [String](#string)). `xs.first()` and `xs.last()` return the first and the last item, or nil for an empty array; an array of optional items has neither, since its nil would be ambiguous. `xs.sorted(compare)` gives a new array of the items in the order that `compare` gives, an [`Ordering`](builtins.md#equatable-comparable-and-hashable) that is `LESS` when its first argument goes first, equal items keeping their order: `names.sorted((a, b) -> a.compare(b))`. `xs.append(ys)` pushes the items that `ys` has when it is called, in order, so `xs.append(xs)` doubles `xs`. `xs.slice(start, end)` gives the items from `start` up to `end`, which it does not hold, as a new array, `end` being `xs.length` by default, and throws an `IndexError` if they are out of range, as a `Binary`'s index by a range does; `xs.reversed()` gives them in the reverse order, and `xs.truncate(n)` removes those after the first `n`, throwing an `IndexError` for a negative `n`. `xs.sorted_by(key)` orders them as `sorted` does, by the `Comparable` key that `key` gives each: `names.sorted_by((name) -> name.binary.length)`.
- `xs.iter()` gives an [`Iter`](#iter) of the items, and `xs.map(f)`, `xs.filter(f)` and `xs.take(n)` one of the items as it maps, filters or takes them.
- `strings.join(separator)` joins a `String[]` into one `String`, and `parts.join(separator)` a `Binary[]` into one `Binary`.
- Arrays cannot be printed.

## Map

```
ages := { 'ann': 31, 'bob': 27 }
squares := Map<Int, Int>()
squares[3] = 9
print ages['ann'] ? 0
```

- `Map<K, V>` maps keys of type `K`, any type of values that `==` compares but an optional one (classes by identity, and structs, anonymous structs, tuples and arrays by their contents, but a class or struct by its own equality and `hash`: see [equality](objects.md#classes-and-structs)), to values of type `V`, which can be any type with values except an optional one. Like arrays, maps are mutable and shared.
- `{ k: v, ... }` makes a map (over several lines too, as an array). Its types come from the expected type if there is one, otherwise the key type from the keys and the value type from the values, each as an [array](#array)'s item type comes from its items (`{ 'a': 1, 'b': 2.5 }` is a `Map<String, Float>`); of entries with the same key, the last one wins. Keys that are names make an [anonymous struct](#anonymous-structs) instead, and the two kinds cannot be mixed: to use a name's value as a key, put it in parentheses, `{ (k): v }`. The empty map is `Map<K, V>()`, or `Map()` where a map type is expected.
- `m[k]` is the value of the key `k`, or nil if there is none, so its type is `V?`. `m[k] = v` adds the key or replaces its value. `+=` and so on do not apply to it, since the key may be missing.
- `m[k, default: d]` is the value of `k`, of type `V`: where `k` is missing, `d` is evaluated, then and only then, and the map holds it under `k` first, even where the index is only read. So `counts[word, default: 0] += 1` counts and `groups[key, default: []].push(item)` groups, each array made for its own key. To read a value without changing the map, write `m[k] ? d`. `+=` and so on read the value, or `d`, and add the key once the result is written, so that one that throws, as an overflow, leaves the map as it was; `m[k, default: d] = v` is an error, as the default would go unused.
- `m.length` is the number of keys, `m.has(k)` tells whether `k` is there and `m.remove(k)` removes it, if it is there.
- `m.entries()` is an `Iter<(K, V)>` of the keys and their values as [tuples](#tuples), `for (key, value) in m.entries()`, in the order the keys were first added (a key removed and added again counts as new), of the entries there when it is made: one removed before the Iter reaches it is skipped, and one added meanwhile is not given, even under a key that was there before. `m.keys()` is an `Iter<K>` of their keys likewise, and `m.values()` an `Iter<V>` of their values; `m.keys().to_array()` gives the keys as an array.

## Set

```
seen := Set<String>()
seen.add 'a'
primes := Set([2, 3, 5])
print primes.has(4)
```

- `Set<T>` holds distinct items of type `T`, which take the rules of a [map](#map)'s keys. It is a map without values: it cannot be compared with `==`, nor be a map key or a set item, as a map cannot.
- `Set<T>()` makes an empty set, or `Set()` where a set type is expected. `Set(xs)` or `Set<T>(xs)` makes one of the items of the array `xs`, the first of equal ones kept, in order.
- `s.length` is the number of items, `s.has(x)` tells whether `x` is there, `s.add(x)` adds it if it is not, and tells whether it did, so that `continue if not seen.add(x)` skips what was seen, and `s.remove(x)` removes it, if it is there.
- `a | b`, `a & b`, `a - b` and `a ^ b` give new sets: the items of either, those of both, those of `a` that `b` has not, and those of one that the other has not, in the order of `a`, followed by the items taken from `b` in its order (see [operators](objects.md#classes-and-structs)); `a |= b` and the like replace `a`. `a.is_subset(b)` tells whether `b` has every item of `a`.
- `s.iter()` is an `Iter<T>` of the items in the order they were first added, of those there when it is made, as `m.entries()` gives a map's entries; `for x in s` goes through it. A set has no indexing, no literal, and none of a map's other methods, nor those of an extend of `Map<K, V>`.

## Iter

```
squares := (x * x for x in 0...10 when x % 2 == 0)
print square for square in squares.take(3)
shouts := ['hi', 'yo'].map((w) -> w + '!').to_array()
```

- `Iter<T>` is a lazy sequence of items of type `T`, which can be any type with values, an optional one too. It computes an item only when asked for it, so nothing happens until it is consumed; a statement that only makes an `Iter` is an error (see [discarded values](errors.md#discarded-values)).
- [Lazy comprehensions](control-flow.md#for-and-ranges) and [functions that yield](functions.md#functions-that-yield) make one, and so do these methods of an array, a `Binary`, an `Iter` or any [Iterable](builtins.md#iterable):
  - `xs.map(f)` gives `f(x)` for each item `x`; its items have the type of `f`'s result.
  - `xs.filter(f)` gives the items for which `f`, which gives a `Bool`, is true.
  - `xs.take(n)` gives the first `n` items, or all of them if there are fewer (none if `n` is not positive).
  - `xs.zip(ys)` gives the items of `xs` and of the Iterable `ys` in pairs, as [tuples](#tuples): `for (name, count) in names.zip(counts)`. Once one has no more items and the other has, it throws `zip of Iterables of different lengths`, so that a missing item is not dropped silently; to pair only the first items of a longer `ys` with an array `xs`, write `xs.zip(ys.take(xs.length))`.

  The `Iter` of an array reads the array as it goes, as a `for` does. The functions' parameter types may be left out, as in `(w) -> w + '!'`; `map`'s result type is that of its function.
- These methods of an Iterable search the items with a function of an item that gives a `Bool`, and stop reading at the first item that decides the result:
  - `xs.any(f)` tells whether `f` is true for some item, and `xs.all(f)` whether it is for every item (so `all` of no items is true).
  - `xs.find(f)` gives the first item for which `f` is true, or nil if there is none. Its type is `T?`, so for items of an optional type it is an error (see [optional values](#optional-values)).
- `xs.sum(zero = 0)` adds the items to `zero` one after another, of items whose `+` gives their own type ([Add<T, T>](builtins.md#operators)): `[1, 2, 3].sum()` is 6 and `[0.5, 1.0].sum()` 1.5, while items of other types give their zero, `['a', 'b'].sum('')`, as 0 is no zero of theirs (see [defaults](functions.md)). It throws as `+` does, so `integer overflow` for a sum beyond its type.
- `xs.min()` and `xs.max()` give the least and the greatest item, of items that are [Comparable](builtins.md#equatable-comparable-and-hashable), and `xs.min_by(key)` and `xs.max_by(key)` the item whose `key(x)`, Comparable, is the least or the greatest; each gives the first of equal ones, or nil if there are no items, so its type is `T?` as `find`'s is.
- `xs.count()` gives the number of items, as `for` goes through them: of a `String`, its `Char`s, `'héllo'.count()` being 5, which no `length` gives (see [String](#string)); of an array, as many as its `length`, which, unlike `count`, gives the number without going through the items. A `String` counts its code points, not what a reader takes for one character: `'e\u{301}'.count()` is 2.
- `xs.fold(initial, combine)` gives `combine` applied to `initial` and the first item, then to that and the next, and so on through the items, or `initial` if there are none: `[3, 1, 2].fold(0, (sum, x) -> sum * 10 + x)` is 312.
- An `Iter` is consumed by `for`, by a comprehension over it, by `it.to_array()`, which gives its items as an array (of a `T` an array can hold), as `xs.to_array()` does those of any Iterable, by `it.any`, `it.all`, `it.find`, `it.fold`, `it.count`, `it.min`, `it.max`, `it.min_by`, `it.max_by` and `it.sum`, and by `it.map`, `it.filter` and `it.take`, whose `Iter` reads it.
- `it.has_next()` tells whether there is an item left, and `it.next()` gives it; past the end, `next` throws `next past the end of an Iter`. `it.iter()` gives the `Iter` itself, so that it is [Iterable](builtins.md#iterable).
- **Iters written in Lerta.** A value of a type with `has_next(): Bool` and `next(): T` converts to an `Iter<T>` where one is expected, as a value converts to an [interface type](objects.md#interfaces) (so it must be a reference): the `Iter` gives the items that its `has_next` and `next` give. The state is typically a `var` that the two functions capture:
  ```
  countdown := (n: Int): Iter<Int> ->
    var i = n
    has_next := -> i > 0
    next := ->
      i -= 1
      i + 1
    { has_next, next }
  ```
- Why a conversion into the builtin `Iter<T>`, rather than `Iter<T>` as an interface: the rule below that an `Iter` can be traversed only once then holds for every `Iter`.
- **An `Iter` can be traversed only once.** Calling `has_next` or `next` traverses it, and so does any consumer above, which throws `an Iter can be traversed only once` if a traversal has started. To go through the items several times, keep them with `to_array()`.
- Why: an `Iter` is not evaluated until consumed (the Rust approach), which avoids CoffeeScript's implicit arrays and the intermediate arrays of an eager `map` in Ruby and JS. Its protocol is `has_next()` / `next()` because with `next(): T?` the end could not be told apart when `T` is optional. A second traversal throws rather than silently giving nothing, as a Python generator does.

## Promise

- `Promise<T>` is the result of a [function that awaits](functions.md#functions-that-await): once settled, it holds a value of type `T`, or an exception, which `await` gives or throws. A `Promise` without a type argument holds no value: `void` is no type of values. It has no methods, and cannot be compared, printed or a member of a union.

## Unions

```
type Expr = Num | Add | Mul
```

- `A | B` is a value of any of the member types: classes and structs, the numbers, `Bool`, `String`, `Binary` and enums so far, as in `Int | String`. A member that is optional, as `String?` in `Int | String?` (`?` binds tighter than `|`), makes nil a value of the union, which is then optional. A discriminated union needs no tag: the member's type itself tells the members apart, with no `kind` field or enum (branch with `is` or `case`). A union whose member is itself a union is flattened, a member written twice counts once, so that `Int | Int` is an `Int`, and the order of the members does not matter.
- `type Name = ...` names a type at the top level. Aliases may refer to types and aliases declared later, but not to themselves.
- After a `=` that ends the line, the indented lines below are the members of a union, one or more on each line:
  ```
  type Shape =
    Circle
    Square | Triangle
  ```
- A member's value fits where the union is expected. A field that every member declares, with the same type in each, can be read from the union: `shape.name` reads the field of whichever member the value is, and `shape.area()` calls a field that holds a function. It can be assigned through the union, `shape.name = n` (and `+=` and so on), when every member is a class whose field is not `const`. A method that every member has, of the same type in each, can be called on the union, with all its arguments, when it is neither generic, nor of a generic type, nor of an extend of an interface: `value.to_string()` calls the method of whichever member the value is, so `print` and `"#{value}"` take a union of `Stringable` types. Other fields and methods cannot be used directly: branch on its type first.
- `x is T` tells whether a union value holds a `T`; for an optional union value, whether it is not nil and holds a `T`. `x is not T` is `not (x is T)`. Like nil tests, it narrows a `const`, a parameter, a loop variable or a path of fields from one to `T` where it holds, and to the other members where it does not (see [control flow](control-flow.md#if-and-while)).
- `x as T?` gives a union value as a `T` if it holds one, and nil otherwise; for an optional union value, nil gives nil. `x as T ? y`, with a space before `?`, is `(x as T?) ? y`: the value as a `T`, or `y`, which is evaluated only then (see [optional values](#optional-values)), and binds as the fallback of `?` does, or is another such cast: `x as T ? y as T ? z` is `x as T ? (y as T ? z)`. `x as T!` gives it as a `T`, and throws `failed cast` otherwise. `x as T` alone is an error, so that a cast shows where it is written whether it fails into nil, falls back or throws. To take a narrowed value under another name, write `if c := x as Circle?`. `is` and `as` are not [keywords](syntax.md#operators), and do not chain with comparisons.
- There is no unchecked cast.
- In `x is T`, `x as T?`, `x as T!` and the patterns of a `case`, `T` may also be a type alias of a union of some of the members: `x is T` then tells whether `x` holds one of them. For a narrowed local, `T` may be any of the members of the type it was declared with.

## Enums

```
enum TokenKind
  IDENTIFIER
  INTEGER
  '('
  '->'

kind: TokenKind = INTEGER
print kind == TokenKind.IDENTIFIER
print kind == '('
```

- `enum Name` declares, at the top level, a type whose values are its members, listed one per line in the indented block below: at least one. A member is a name, `INTEGER`, or a string literal without interpolation, `'('`. Its text is the name, or the literal's value; no two members have the same text, so `IDENTIFIER` and `'IDENTIFIER'` cannot both be members. A name member cannot be `parse`, which `Name.parse` takes (`'parse'` can be). The members carry no data.
- `Name.MEMBER` is a member named by its name. Where an enum is expected, a member stands alone: its name, `INTEGER` above, or, for a member declared as a string literal, that literal, `'('`; each member has that one spelling. That is wherever an expected type reaches a literal (see [Byte](#byte)), and the other operand of `==` and `!=`, and the patterns of a [`case`](control-flow.md#case-with-a-subject) on an enum. A string literal there that is no such member is an error, `'INTEGER'` included; where no enum is expected, it is a `String`. A member name alone cannot take the place of another name in scope, such as a local, a function or an import of the same name; it must be qualified there. Without an expected enum, a member name alone is an undefined name.
- `==` and `!=` compare two values of the same enum. There is no ordering. An enum can be a [`Map`](#map) key, and is `Stringable`: `kind.to_string()` gives the member's text, `'INTEGER'` or `'('`. `Name.parse(text)` gives the member whose text is the `String` `text`, or `nil`; it must be called. An enum cannot be a member of a union so far.

## Anonymous structs

```
divide := (a: Int, b: Int): { quotient: Int, remainder: Int } ->
  { quotient: a / b, remainder: a % b }
{ quotient, remainder } := divide(17, 5)
```

- `{ x: 1, y: 'a' }` is a value of the anonymous struct type `{ x: Int, y: String }`; `{ x, y }` is short for `{ x: x, y: y }`. Where an anonymous struct type (or an optional one) is expected, each field the type has takes its type from it; the others, and all fields elsewhere, take the types of their values. A field cannot be nil alone. `?` after the type makes it optional: `{ a: Int }?`.
- **Spread.** A spread first, `{ r..., z: 3 }`, gives the fields of the anonymous struct `r` but those written after it, read from it: a new anonymous struct, whose fields written may have other types than those of `r`. Where a struct is expected, `{ p..., x: 1 }` constructs it from `p`, as `Point(p..., x: 1)` does (see [construction](objects.md#classes-and-structs)). The spread is of a name, `@` or a path of fields from one, which the fields are read from where it is, and is the only one, before the fields.
- Two anonymous struct types are the same if their fields have the same names and types, in any order. An anonymous struct is a different type from any class or struct.
- Where a struct (or an optional one) is expected, `{ x: 1 }` constructs that struct instead, as `Point(x: 1)` does with the same fields as named arguments (see [construction](objects.md)): `points: Point[] = [{ x: 1 }, { x: 2, y: 3 }]`. The type arguments of a generic struct come from the expected type. It does not construct a class, nor a struct that a union or an interface is expected to hold.
- Its fields are read with `.` and cannot be changed. It is useful to return several values.
- A call may give the last argument, when its parameter is of an anonymous struct type, as named arguments without `{}`, as for a [struct](functions.md): `draw('a', x: 1, y: 2)` is `draw('a', { x: 1, y: 2 })`. Named arguments come after the others, as in the construction of a class or struct.
- `{ a, b } := value` (or `var { a, b } = value`) declares `a` and `b` from the fields of those names of an anonymous struct, a class or a struct; the value is evaluated once. It must be on a line of its own.

## Tuples

```
swap := (t: (String, Int)): (Int, String) ->
  (s, n) := t
  (n, s)
```

- `(1, 'a')` is a value of the tuple type `(Int, String)`, of two or more items. `(a)` is only parentheses. Where a tuple type of as many items (or an optional one) is expected, each item takes its type from it; elsewhere, the types of their values. An item cannot be nil alone. `?` after the type makes it optional: `(Int, String)?`.
- Two tuple types are the same if their items have the same types in the same order.
- Its items cannot be read by position: `(a, b) := value` (or `var (a, b) = value`) takes it apart, declaring a name for each item, so that each gets a name where it is used. The value must be a tuple of as many items; it is evaluated once, and `_` discards an item. It must be on a line of its own. A loop takes its items apart too (see [for](control-flow.md#for-and-ranges)).
- Why tuples beside [anonymous structs](#anonymous-structs): a tuple's items are named by the code that uses it, as is fitting for what `zip` gives, and an anonymous struct's fields by the code that makes it, as for the several results of a function.
