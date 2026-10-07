# Types

## Int

- `Int` is a signed 64-bit integer.
- A literal must fit in `Int`, including its sign (`-9223372036854775808` is the minimum).
- Comparisons (`==` `!=` `<` `<=` `>` `>=`) between `Int`s give a `Bool`.
- `+` `-` `*` and prefix `-` throw `integer overflow` when the result does not fit.
- `/` is the quotient, truncated toward zero, and `%` is the remainder (`-7 / 2 == -3`, `-7 % 2 == -1`). Both throw `division by zero` when the divisor is 0, and `integer overflow` for the minimum value divided by `-1`.

## Bool

- `Bool` has the values `true` and `false`.
- `==` and `!=` compare two `Bool`s. There is no ordering (`<` and so on).

## String

- `+` concatenates two `String`s into a new one.
- `==` and `!=` compare two `String`s byte by byte.

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

`String`, `Int` and `Bool` have `to_string(): String` (for arrays, see [Array](#array)), which gives the text that `print` writes. A method must be called: `x.to_string` without `()` is an error.
