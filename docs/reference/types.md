# Types

Type names: `Int`, `Byte`, `Float`, `Bool`, `String`, `Binary`, `T[]`, `Map<K, V>`, `Iter<T>`, `Promise<T>` and `Promise`, `T?`, unions `A | B`, function types, anonymous struct types such as `{ x: Int }`, tuple types such as `(Int, String)`, the names of classes, structs, enums, interfaces and `type` aliases, `Self` in an [interface](objects.md#interfaces) or an extend of one, the type parameters of a generic function or extend in it, and `void` and `never` as a return type. How they are written is in [the syntax](syntax.md#calls).

The methods of the builtin types are listed in [builtins](builtins.md#methods-of-the-builtin-types). Methods can only be called (see [function values](functions.md#function-values)).

## Int

- `Int` is a signed 64-bit integer.
- A literal must fit in `Int`, including its sign (`-9223372036854775808`, or `-0x8000000000000000`, is the minimum).
- Comparisons (`==` `!=` `<` `<=` `>` `>=`) between `Int`s give a `Bool`.
- `+` `-` `*` and prefix `-` throw `integer overflow` when the result does not fit.
- `/` is the quotient, truncated toward zero, and `%` is the remainder (`-7 / 2 == -3`, `-7 % 2 == -1`). Both throw `division by zero` when the divisor is 0, and `integer overflow` for the minimum value divided by `-1`.
- `&` `|` `^` are bitwise and, or and exclusive or, and `x ^ -1` inverts the bits. `x << n` throws `integer overflow` unless the result fits, as `x * 2` to the `n` would, so that it never changes the sign, and `x >> n` shifts in copies of the sign bit. A shift throws `shift out of range` when `n` is negative or 64 or more.
- `x.wrapping_add(y)`, `wrapping_sub` and `wrapping_mul` do the same without the check, wrapping around modulo 2 to the 64, for hashes and checksums.
- Why one name each for `Int` and `Byte`, rather than also `Int64` and `UInt8`: the common types have no second name to choose between. Why the arithmetic of every integer type throws on overflow, an unsigned one too: a size that goes below 0 would otherwise be a large number, silently; a computation that means to wrap around says so with a method, so that an arithmetic operator has one rule for every type. A bitwise operator works on bits, and `<<` of an unsigned type drops those shifted out; that of a signed type checks, as it would change the sign.

## Byte

- `Byte` is an unsigned 8-bit integer.
- `+` `-` `*` throw `integer overflow` when the result is not from 0 to 255, as `250 + 10` and `1 - 2` are not; there is no prefix `-`, which would throw for all but 0; `wrapping_add`, `wrapping_sub` and `wrapping_mul` wrap around modulo 256, `250.wrapping_add(10)` being `4`. `/` and `%` throw `division by zero` when the divisor is 0. Comparisons treat values as unsigned. `&` `|` `^` are bitwise, `b << n` drops the bits shifted out and `b >> n` shifts in zeros; a shift throws `shift out of range` when `n` is 8 or more.
- There are no implicit conversions: `Byte` and `Int` cannot be mixed in one operation. `b.to_int()` converts a `Byte` to an `Int`, and `n.to_byte()` an `Int` to a `Byte`, throwing `integer overflow` unless it is from 0 to 255.
- `b.is_digit()`, `b.is_letter()` and `b.is_space()` tell whether it is an ASCII digit, letter (`a` to `z`, `A` to `Z`) or space (a space, `\t`, `\n` or `\r`). `b.is_utf8_continuation()` tells whether it continues a UTF-8 sequence (0x80 to 0xBF), as when counting the code points of a `Binary`.
- **The type of a literal is decided by context.** Where a `Byte` or a `Byte?` is expected, an integer literal from 0 to 255 is a `Byte`, and so is a string literal of one byte (`'a'`). The expected type reaches literals inside arithmetic (`c == 1 + 2`), `case` arms, array items and return values. An operand of `+`, `==`, `<` and so on whose type comes from the context is expected to have the type of the other operand, so `c >= '0'` and `'0' <= c` compare two `Byte`s when `c` is one; likewise `[1, c]` is a `Byte[]`. Without such a context, `'a'` is a `String` and `1` an `Int`.

## Sized integers

```
const flags: UInt16 = 0x8001
const offset: Int32 = -4
print (flags >> 15).to_int() + offset.to_int()
```

- `Int8`, `Int16` and `Int32` are signed integers of 8, 16 and 32 bits, and `UInt16`, `UInt32` and `UInt64` unsigned ones of 16, 32 and 64 bits; `Byte` is the unsigned one of 8 bits and `Int` the signed one of 64, with no second names.
- Each takes the rules of `Int` if it is signed and those of `Byte` if it is unsigned: `+` `-` `*` throw `integer overflow` when the result does not fit, `/` and `%` throw `division by zero`, and the least value of a signed type divided by `-1` overflows; comparisons follow the sign; prefix `-` is for the signed ones; `&` `|` `^` `<<` `>>` work by the type's bits, a shift throwing `shift out of range` from the bits up, and `<<` of a signed type checked as that of `Int` is; `wrapping_add`, `wrapping_sub` and `wrapping_mul` wrap around modulo 2 to the bits.
- An integer literal is of the integer type that is expected, and must fit in it; elsewhere it is an `Int`. `CodePoint` is an alias of `UInt32` for a Unicode code point; where a `UInt32` is expected, a string literal of one code point is that code point, `c == 'é'`, as a string literal of one byte is that byte where a `Byte` is. A `UInt64` literal cannot be above the largest `Int` so far.
- There are no implicit conversions between integer types. `x.to_int()`, `x.to_byte()`, `x.to_int8()`, `x.to_int16()`, `x.to_int32()`, `x.to_uint16()`, `x.to_uint32()` and `x.to_uint64()` convert a value of any integer type to that type, throwing `integer overflow` unless it fits there, as a negative value fits in no unsigned type. `x.to_float()` gives the nearest `Float`. `x.to_string()` gives the decimal digits, with a `-` for a negative value.
- They compare with `==`, are map keys and set items, are written by an array's `to_string`, and are patterns of a `case`; arrays and maps hold each at its own size. A C function may take and give them as the C types of their bits and sign, as `int32_t`.

## Float

- `Float` is a 64-bit IEEE 754 double that is always finite: no `Float` is an infinity or NaN. An operation whose result would be one throws instead, so `==` holds for every value and its own copy, and `<` orders all values.
- A literal has a fraction or an exponent, or both (`1.5`, `1e9`, `2.5e-3`; see [syntax](syntax.md)), and rounds to the nearest double. One too large to be finite is an error. **Where a `Float` or a `Float?` is expected, an integer literal is a `Float` too** (`const x: Float = 3`), as it becomes a `Byte` where one is expected (below), and a decimal one may then be beyond `Int`, rounding as a float literal does (`const x: Float = 18446744073709551616`). A hexadecimal one may not, as it stands for the bits of an `Int`.
- `+` `-` `*` `/` and prefix `-` follow IEEE 754. `/` throws `division by zero` when the divisor is 0, and the others `float overflow` when the result is too large to be finite. There is no `%`.
- Comparisons and `==` follow IEEE 754 too: `-0.0 == 0.0`, and a map whose keys are `Float`s, or a set of them, holds them as one key, `0.0`. `0.1 + 0.2 == 0.3` is false, as the doubles nearest these values do not add up exactly.
- `case` cannot branch on a `Float`, as an exact value of a `Float` is rarely what a branch means.
- There are no implicit conversions: `Float` and `Int` cannot be mixed in one operation. `n.to_float()` gives the nearest `Float` to an `Int`, and `x.to_int()` the `Int` of a `Float` truncated toward zero, throwing `integer overflow` unless it fits.
- `x.to_string()`, which `print` and interpolation use, gives the fewest digits that read back as the value: positional from `1e-4` up to `1e16`, with `.0` for a whole number (`1.0`, `0.30000000000000004`, `-0.0`), and scientific beyond (`1e+16`, `5e-324`), as Python writes them.
- Why no infinity and no NaN: a NaN goes on silently through arithmetic until a comparison much later gives a wrong answer, and makes `==` fail for a value and itself; an operation that has no finite result is an error as `Int` overflow is. Whether to allow infinities later is an [open question](../roadmap/language.md#open-questions); allowing them would break no program, while taking them away would.

## Bool

- `Bool` has the values `true` and `false`.
- `==` and `!=` compare two `Bool`s. There is no ordering (`<` and so on).

## String

- A `String` is immutable text in UTF-8.
- `+` concatenates two `String`s into a new one.
- `s.split(separator)` gives the pieces of `s` between the occurrences of `separator`, in a `String[]`, empty pieces too: `'a,,b'.split(',')` is `['a', '', 'b']`, and `''.split(',')` is `['']`. An empty separator throws a `ValueError`, `split by an empty separator`.
- `s.starts_with(prefix)` tells whether `s` begins with the bytes of `prefix`, and `s.ends_with(suffix)` whether it ends with those of `suffix`.
- `s.without_prefix(prefix)` gives what follows `prefix` in `s`, or nil if `s` does not begin with it: `'std:io'.without_prefix('std:')` is `'io'`. `s.without_suffix(suffix)` gives what comes before `suffix`, or nil.
- `a.compare(b)` is `LESS`, `EQUAL` or `GREATER` as `a` goes before, with or after `b` in the order of their bytes, which does not depend on a locale: a prefix goes first. `<`, `<=`, `>` and `>=` order two `String`s so.
- `==` and `!=` compare two `String`s byte by byte.
- A `String` is [Iterable](builtins.md#iterable): `for c in s`, comprehensions and `s.iter()` give its code points, as `CodePoint`s, in order, so `'é'` gives 233; its bytes are `s.binary`.
- Why code points rather than bytes or graphemes: a `Binary` already gives the bytes, and code points are what UTF-8 encodes, while graphemes need Unicode's tables.
- Why UTF-8: a PEP 393 style variable-width representation was considered, but it costs a conversion at every I/O boundary. There is no integer indexing `s[i]`, which could be taken for a character, and no StringBuilder, since `push` onto a `String[]` and `join` is O(n) (the Python approach), an idiom that stays valid once ropes make `+` O(1).

## Binary

- `Binary` is an immutable sequence of bytes; a mutable one is a `Byte[]`. `s.binary` gives the bytes of a `String` (its UTF-8 encoding) without copying them; `b.text()` goes back (see below).
- `b.length` is the number of bytes, and `b[i]` is the byte at `i`, a `Byte`; an index outside `0 ... b.length` throws `index out of range`.
- `==` and `!=` compare two `Binary`s byte by byte.
- `b.occurs_at(index, part)` tells whether the bytes of `part` occur in `b` at `index`; it is false where `part` does not fit.
- `for b in bytes` goes through the bytes (see [for](control-flow.md#for-and-ranges)), as comprehensions over a `Binary` do.
- `bytes.to_binary()` copies the items of a `Byte[]` into a new `Binary`.
- `b.slice(start, end)` copies the bytes from `start` up to, but not including, `end` into a new `Binary`; it throws `slice out of range` unless `0 <= start <= end <= b.length`.
- Why `Binary` is separate from `String`: a `String` only adds the invariant "valid UTF-8", rather than "a string is any byte sequence" as in Python 2 and Go.
- `b.text(start, end)` gives the bytes from `start` up to `end` as a `String` if they are valid UTF-8, or nil otherwise; it throws an `IndexError` if they are out of range. `start` is 0 and `end` is `b.length` by default, and `b.text()` gives the whole `Binary` without copying its bytes. `b.text()!` or `b.text() ? throw ...` takes a String where the bytes must be UTF-8.

## Optional values

```
var name: String? = nil
print name ? 'nobody'
if const n = '42'.parse_int()
  print n + 1
```

- `T?` is a `T` or `nil`, where `T` is not itself optional: `T?` of an optional type, such as `Name?` after `type Name = String?`, is an error, since its nil would be ambiguous. A `T` or `nil` fits where a `T?` is expected. `nil` has no type of its own, so `const x = nil` needs a type (`const x: String? = nil`).
- `x!` is `x` without nil; it throws `unwrapped nil` if `x` is nil.
- `x?.name` is nil if `x` is nil, and otherwise `x.name` followed by the rest of the chain of `.`, calls, indexes and `!` after it, which is skipped as a whole: in `node?.name.binary.length`, a nil `node` gives nil. Its type is that of the chain, made optional. A member of the chain that may be nil takes its own `?.`: `node?.next?.name`. `x` is evaluated once, and must be optional. As a statement, `counter?.bump()` runs the chain only if `counter` is not nil.
- `x ? fallback` is `x` without nil, or `fallback`, which has that type, if `x` is nil. The fallback is evaluated only then. `?` binds tighter than comparisons, so `ages[name] ? 0 > 18` compares the age, and weaker than ranges and arithmetic; `a ? b ? c` is `a ? (b ? c)`.
- `x == nil` and `x != nil` test an optional value. `==` and `!=` also compare an optional value with another of its type, or with a value of its type without nil, wherever they compare the values themselves: two nils are equal, nil and a value are not, and two values compare as usual. An expected enum reaches the other operand through the optional (`kind == '('` for a `kind: TokenKind?`). The ordering operators (`<` and so on) do not take optional values.
- An optional value can be a condition (see [control flow](control-flow.md#if-and-while)).
- An array cannot hold optional `Int`, `Byte`, `Float` or `Bool` values yet; optional references are fine (`String?[]`).
- `s.parse_int()` gives the `Int` that a `String` of decimal digits, with an optional leading `-`, stands for, or nil if it is anything else or does not fit in an `Int`. `s.parse_float()` gives the nearest `Float` to a decimal number, with an optional leading `-`, a fraction after `.` and an exponent after `e` or `E` (`'1.5'`, `'-2'`, `'3e-4'`), or nil if it is anything else or too large to be finite; one too small rounds to zero (`'1e-999'` gives `0.0`).

## Array

```
const xs = [3, 1, 2]
const names: String[] = []
names.push('a')
print xs[0] + xs.length
```

- `T[]` is a growable sequence of items of type `T`, which can be any type with values (not `void`). Arrays are mutable and shared: assigning or passing an array does not copy it.
- `[a, b, c]` makes an array (over several lines too: see [lines inside brackets](syntax.md#lines-inside-brackets)). Its item type comes from the expected type if there is one (a type annotation, a parameter, a return type), otherwise from the first item whose type does not come from the context and that gives a value, so a `throw` does not count, and `[1, c]` is a `Byte[]` when `c` is a `Byte` (see [Byte](#byte)). `[]` needs an expected type.
- **Spread.** An item `xs...` gives the items of `xs`, anything a `for` goes through, in its place: `[first, rest..., last]`, `[header.binary..., 0x0A]`. Its items count as the array's items in the rules above. A spread can only be an item of an array literal so far, not of a comprehension's element or of a call.
- `xs[i]` reads an item and `xs[i] = value` replaces one (`+=` and so on work on `Int` items). An index outside `0 ... xs.length` throws `index out of range`.
- `xs.length` is the number of items.
- `==` and `!=` compare two arrays by their items, in order (see [equality](objects.md#classes-and-structs)).
- `xs.push(item)` appends an item. `xs.pop()` removes and returns the last one; on an empty array it throws `pop from an empty array`. `xs.contains(x)` tells whether an item is `==` to `x`, for items that `==` compares (other items are an error), and `xs.find_index(f)` gives the place of the first item for which `f` is true, or nil. `xs.first()` and `xs.last()` return the first and the last item, or nil for an empty array; an array of optional items has neither, since its nil would be ambiguous. `xs.sorted(compare)` gives a new array of the items in the order that `compare` gives, an [`Ordering`](builtins.md#equatable-comparable-and-hashable) that is `LESS` when its first argument goes first, equal items keeping their order: `names.sorted((a, b) -> a.compare(b))`. `xs.append(ys)` pushes the items that `ys` has when it is called, in order, so `xs.append(xs)` doubles `xs`.
- `xs.iter()` gives an [`Iter`](#iter) of the items, and `xs.map(f)`, `xs.filter(f)` and `xs.take(n)` one of the items as it maps, filters or takes them.
- `strings.join(separator)` joins a `String[]` into one `String`.
- Arrays cannot be printed.

## Map

```
const ages = { 'ann': 31, 'bob': 27 }
const squares = Map<Int, Int>()
squares[3] = 9
print ages['ann'] ? 0
```

- `Map<K, V>` maps keys of type `K`, any type of values that `==` compares but an optional one (classes by identity, and structs, anonymous structs, tuples and arrays by their contents, but a class or struct by its own equality and `hash`: see [equality](objects.md#classes-and-structs)), to values of type `V`, which can be any type with values except an optional one. Like arrays, maps are mutable and shared.
- `{ k: v, ... }` makes a map (over several lines too, as an array). Its types come from the expected type if there is one, otherwise from the first entry; of entries with the same key, the last one wins. Keys that are names make an [anonymous struct](#anonymous-structs) instead, and the two kinds cannot be mixed: to use a name's value as a key, put it in parentheses, `{ (k): v }`. The empty map is `Map<K, V>()`, or `Map()` where a map type is expected.
- `m[k]` is the value of the key `k`, or nil if there is none, so its type is `V?`. `m[k] = v` adds the key or replaces its value. `+=` and so on do not apply, since the key may be missing.
- `m.length` is the number of keys, `m.has(k)` tells whether `k` is there and `m.remove(k)` removes it, if it is there. `m.get_or_put(k, make)` gives the value of `k`, setting it to `make()` first if `k` is not there.
- `m.keys()` is a `K[]` of the keys in the order they were first added (a key removed and added again counts as new). `m.entries()` is an `Iter<(K, V)>` of the keys and their values as [tuples](#tuples), `for (key, value) in m.entries()`, of the entries there when it is made, in that order: one removed before the Iter reaches it is skipped, and one added meanwhile is not given, even under a key that was there before. `m.values()` is an `Iter<V>` of their values likewise.

## Set

```
const seen = Set<String>()
seen.add 'a'
const primes = Set([2, 3, 5])
print primes.has(4)
```

- `Set<T>` holds distinct items of type `T`, which take the rules of a [map](#map)'s keys. It is a map without values: it cannot be compared with `==`, nor be a map key or a set item, as a map cannot.
- `Set<T>()` makes an empty set, or `Set()` where a set type is expected. `Set(xs)` or `Set<T>(xs)` makes one of the items of the array `xs`, the first of equal ones kept, in order.
- `s.length` is the number of items, `s.has(x)` tells whether `x` is there, `s.add(x)` adds it if it is not, and `s.remove(x)` removes it, if it is there.
- `s.iter()` is an `Iter<T>` of the items in the order they were first added, of those there when it is made, as `m.entries()` gives a map's entries; `for x in s` goes through it. A set has no indexing, no literal, and none of a map's other methods, nor those of an extend of `Map<K, V>`.

## Iter

```
const squares = (x * x for x in 0...10 when x % 2 == 0)
for square in squares.take(3)
  print square
const shouts = ['hi', 'yo'].map((w) -> w + '!').to_array()
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
- An `Iter` is consumed by `for`, by a comprehension over it, by `it.to_array()`, which gives its items as an array (of a `T` an array can hold), as `xs.to_array()` does those of any Iterable, by `it.any`, `it.all` and `it.find`, and by `it.map`, `it.filter` and `it.take`, whose `Iter` reads it.
- `it.has_next()` tells whether there is an item left, and `it.next()` gives it; past the end, `next` throws `next past the end of an Iter`. `it.iter()` gives the `Iter` itself, so that it is [Iterable](builtins.md#iterable).
- **Iters written in Lerta.** A value of a type with `has_next(): Bool` and `next(): T` converts to an `Iter<T>` where one is expected, as a value converts to an [interface type](objects.md#interfaces) (so it must be a reference): the `Iter` gives the items that its `has_next` and `next` give. The state is typically a `var` that the two functions capture:
  ```
  const countdown = (n: Int): Iter<Int> ->
    var i = n
    const has_next = -> i > 0
    const next = ->
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

- `A | B` is a value of any of the member types, which are classes and structs so far. A discriminated union needs no tag: the member's type itself tells the members apart, with no `kind` field or enum (branch with `is` or `case`). A union whose member is itself a union is flattened, and the order of the members does not matter.
- `type Name = ...` names a type at the top level. Aliases may refer to types and aliases declared later, but not to themselves.
- After a `=` that ends the line, the indented lines below are the members of a union, one or more on each line:
  ```
  type Shape =
    Circle
    Square | Triangle
  ```
- A member's value fits where the union is expected. A field that every member declares, with the same type in each, can be read from the union: `shape.name` reads the field of whichever member the value is, and `shape.area()` calls a field that holds a function. It can be assigned through the union, `shape.name = n` (and `+=` and so on), when every member is a class whose field is not `const`. Other fields and methods cannot be used directly: branch on its type first.
- `x is T` tells whether a union value holds a `T`; for an optional union value, whether it is not nil and holds a `T`. `x is not T` is `not (x is T)`. Like nil tests, it narrows a `const`, a parameter, a loop variable or a path of fields from one to `T` where it holds, and to the other members where it does not (see [control flow](control-flow.md#if-and-while)).
- `x as T?` gives a union value as a `T` if it holds one, and nil otherwise; for an optional union value, nil gives nil. `x as T ? y`, with a space before `?`, is `(x as T?) ? y`: the value as a `T`, or `y`, which is evaluated only then (see [optional values](#optional-values)), and binds as the fallback of `?` does, or is another such cast: `x as T ? y as T ? z` is `x as T ? (y as T ? z)`. `x as T!` gives it as a `T`, and throws `failed cast` otherwise. `x as T` alone is an error, so that a cast shows where it is written whether it fails into nil, falls back or throws. To take a narrowed value under another name, write `if const c = x as Circle?`. `is` and `as` are not [keywords](syntax.md#operators), and do not chain with comparisons.
- There is no unchecked cast.
- In `x is T`, `x as T?`, `x as T!` and the patterns of a `case`, `T` may also be a type alias of a union of some of the members: `x is T` then tells whether `x` holds one of them. For a narrowed local, `T` may be any of the members of the type it was declared with.

## Enums

```
enum TokenKind
  IDENTIFIER
  INTEGER
  '('
  '->'

const kind: TokenKind = INTEGER
print kind == TokenKind.IDENTIFIER
print kind == '('
```

- `enum Name` declares, at the top level, a type whose values are its members, listed one per line in the indented block below: at least one. A member is a name, `INTEGER`, or a string literal without interpolation, `'('`. Its text is the name, or the literal's value; no two members have the same text, so `IDENTIFIER` and `'IDENTIFIER'` cannot both be members. A name member cannot be `parse`, which `Name.parse` takes (`'parse'` can be). The members carry no data.
- `Name.MEMBER` is a member named by its name. Where an enum is expected, a member stands alone: its name, `INTEGER` above, or, for a member declared as a string literal, that literal, `'('`; each member has that one spelling. That is wherever an expected type reaches a literal (see [Byte](#byte)), and the other operand of `==` and `!=`, and the patterns of a [`case`](control-flow.md#case-with-a-subject) on an enum. A string literal there that is no such member is an error, `'INTEGER'` included; where no enum is expected, it is a `String`. A member name alone cannot take the place of another name in scope, such as a local, a function or an import of the same name; it must be qualified there. Without an expected enum, a member name alone is an undefined name.
- `==` and `!=` compare two values of the same enum. There is no ordering. An enum can be a [`Map`](#map) key, and is `Stringable`: `kind.to_string()` gives the member's text, `'INTEGER'` or `'('`. `Name.parse(text)` gives the member whose text is the `String` `text`, or `nil`; it must be called. An enum cannot be a member of a union so far.

## Anonymous structs

```
const divide = (a: Int, b: Int): { quotient: Int, remainder: Int } ->
  { quotient: a / b, remainder: a % b }
const { quotient, remainder } = divide(17, 5)
```

- `{ x: 1, y: 'a' }` is a value of the anonymous struct type `{ x: Int, y: String }`; `{ x, y }` is short for `{ x: x, y: y }`. Where an anonymous struct type (or an optional one) is expected, each field the type has takes its type from it; the others, and all fields elsewhere, take the types of their values. A field cannot be nil alone. `?` after the type makes it optional: `{ a: Int }?`.
- Two anonymous struct types are the same if their fields have the same names and types, in any order. An anonymous struct is a different type from any class or struct.
- Its fields are read with `.` and cannot be changed. It is useful to return several values.
- A call may give the last argument, when its parameter is of an anonymous struct type, as named arguments without `{}`: `draw('a', x: 1, y: 2)` is `draw('a', { x: 1, y: 2 })`. Named arguments come after the others, as in the construction of a class or struct.
- `const { a, b } = value` (or `var`) declares `a` and `b` from the fields of those names of an anonymous struct, a class or a struct; the value is evaluated once. It must be on a line of its own.

## Tuples

```
const swap = (t: (String, Int)): (Int, String) ->
  const (s, n) = t
  (n, s)
```

- `(1, 'a')` is a value of the tuple type `(Int, String)`, of two or more items. `(a)` is only parentheses. Where a tuple type of as many items (or an optional one) is expected, each item takes its type from it; elsewhere, the types of their values. An item cannot be nil alone. `?` after the type makes it optional: `(Int, String)?`.
- Two tuple types are the same if their items have the same types in the same order.
- Its items cannot be read by position: `const (a, b) = value` (or `var`) takes it apart, declaring a name for each item, so that each gets a name where it is used. The value must be a tuple of as many items; it is evaluated once, and `_` discards an item. It must be on a line of its own. A loop takes its items apart too (see [for](control-flow.md#for-and-ranges)).
- Why tuples beside [anonymous structs](#anonymous-structs): a tuple's items are named by the code that uses it, as is fitting for what `zip` gives, and an anonymous struct's fields by the code that makes it, as for the several results of a function.
