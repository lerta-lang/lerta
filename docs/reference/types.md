# Types

## Int

- `Int` is a signed 64-bit integer.
- A literal must fit in `Int`, including its sign (`-9223372036854775808` is the minimum).
- Comparisons (`==` `!=` `<` `<=` `>` `>=`) between `Int`s give a `Bool`.
- `+` `-` `*` and prefix `-` throw `integer overflow` when the result does not fit.
- `/` is the quotient, truncated toward zero, and `%` is the remainder (`-7 / 2 == -3`, `-7 % 2 == -1`). Both throw `division by zero` when the divisor is 0, and `integer overflow` for the minimum value divided by `-1`.

## UInt8

- `UInt8` is an unsigned 8-bit integer; `Byte` is another name for it.
- `+` `-` `*` and prefix `-` wrap around (`250 + 10` is `4`). `/` and `%` throw `division by zero` when the divisor is 0. Comparisons treat values as unsigned.
- There are no implicit conversions: `UInt8` and `Int` cannot be mixed in one operation. `b.to_int()` converts a `UInt8` to an `Int`.
- **The type of a literal is decided by context.** Where a `UInt8` is expected, an integer literal from 0 to 255 is a `UInt8`, and so is a string literal of one byte (`'a'`). The expected type reaches literals inside arithmetic (`c == 1 + 2`), `case` arms, array items and return values. An operand of `+`, `==`, `<` and so on whose type comes from the context is expected to have the type of the other operand, so `c >= '0'` and `'0' <= c` compare two `UInt8`s when `c` is one; likewise `[1, c]` is an `Array<UInt8>`. Without such a context, `'a'` is a `String` and `1` an `Int`.

## Bool

- `Bool` has the values `true` and `false`.
- `==` and `!=` compare two `Bool`s. There is no ordering (`<` and so on).

## String

- `+` concatenates two `String`s into a new one.
- `==` and `!=` compare two `String`s byte by byte.

## Binary

- `Binary` is an immutable sequence of bytes. `s.binary` gives the bytes of a `String` (its UTF-8 encoding) without copying them.
- `b.length` is the number of bytes, and `b[i]` is the byte at `i`, a `UInt8`; an index outside `0 ... b.length` throws `index out of range`.
- `b.slice(start, end)` copies the bytes from `start` up to, but not including, `end` into a new `Binary`; it throws `slice out of range` unless `0 <= start <= end <= b.length`.

## Array

```
const xs = [3, 1, 2]
const names: Array<String> = []
names.push('a')
print xs[0] + xs.length
```

- `Array<T>` is a growable sequence of items of type `T`, which can be any type with values (not `void` or a function type). Arrays are mutable and shared: assigning or passing an array does not copy it.
- `[a, b, c]` makes an array (on one line). Its item type comes from the expected type if there is one (a type annotation, a parameter, a return type), otherwise from the first item. `[]` needs an expected type.
- `xs[i]` reads an item and `xs[i] = value` replaces one (`+=` and so on work on `Int` items). An index outside `0 ... xs.length` throws `index out of range`.
- `xs.length` is the number of items.
- `xs.push(item)` appends an item. `xs.pop()` removes and returns the last one; on an empty array it throws `pop from an empty array`.
- `strings.join(separator)` joins an `Array<String>` into one `String`.
- Arrays cannot be compared or printed.

## Methods

`String`, `Int`, `UInt8` and `Bool` have `to_string(): String` (for arrays, see [Array](#array)), which gives the text that `print` writes. A method must be called: `x.to_string` without `()` is an error.
