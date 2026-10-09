# Types

## Int

- `Int` is a signed 64-bit integer.
- A literal must fit in `Int`, including its sign (`-9223372036854775808`, or `-0x8000000000000000`, is the minimum).
- Comparisons (`==` `!=` `<` `<=` `>` `>=`) between `Int`s give a `Bool`.
- `+` `-` `*` and prefix `-` throw `integer overflow` when the result does not fit.
- `/` is the quotient, truncated toward zero, and `%` is the remainder (`-7 / 2 == -3`, `-7 % 2 == -1`). Both throw `division by zero` when the divisor is 0, and `integer overflow` for the minimum value divided by `-1`.

## Byte

- `Byte` is an unsigned 8-bit integer.
- `+` `-` `*` and prefix `-` wrap around (`250 + 10` is `4`). `/` and `%` throw `division by zero` when the divisor is 0. Comparisons treat values as unsigned.
- There are no implicit conversions: `Byte` and `Int` cannot be mixed in one operation. `b.to_int()` converts a `Byte` to an `Int`, and `n.to_byte()` an `Int` to a `Byte`, throwing `integer overflow` unless it is from 0 to 255.
- `b.is_digit()`, `b.is_letter()` and `b.is_space()` tell whether it is an ASCII digit, letter (`a` to `z`, `A` to `Z`) or space (a space, `\t`, `\n` or `\r`).
- **The type of a literal is decided by context.** Where a `Byte` is expected, an integer literal from 0 to 255 is a `Byte`, and so is a string literal of one byte (`'a'`). The expected type reaches literals inside arithmetic (`c == 1 + 2`), `case` arms, array items and return values. An operand of `+`, `==`, `<` and so on whose type comes from the context is expected to have the type of the other operand, so `c >= '0'` and `'0' <= c` compare two `Byte`s when `c` is one; likewise `[1, c]` is an `Array<Byte>`. Without such a context, `'a'` is a `String` and `1` an `Int`.

## Bool

- `Bool` has the values `true` and `false`.
- `==` and `!=` compare two `Bool`s. There is no ordering (`<` and so on).

## String

- A `String` is immutable text in UTF-8.
- `+` concatenates two `String`s into a new one.
- `s.split(separator)` gives the pieces of `s` between the occurrences of `separator`, in an `Array<String>`, empty pieces too: `'a,,b'.split(',')` is `['a', '', 'b']`, and `''.split(',')` is `['']`. An empty separator throws `split by an empty separator`.
- `==` and `!=` compare two `String`s byte by byte.

## Binary

- `Binary` is an immutable sequence of bytes; a mutable one is an `Array<Byte>`. `s.binary` gives the bytes of a `String` (its UTF-8 encoding) without copying them; `b.decode_utf8()` goes back (see [Optional values](#optional-values)).
- `b.length` is the number of bytes, and `b[i]` is the byte at `i`, a `Byte`; an index outside `0 ... b.length` throws `index out of range`.
- `==` and `!=` compare two `Binary`s byte by byte.
- `b.occurs_at(index, part)` tells whether the bytes of `part` occur in `b` at `index`; it is false where `part` does not fit.
- `for b in bytes` goes through the bytes (see [for](control-flow.md#for-and-ranges)), as comprehensions over a `Binary` do.
- `bytes.to_binary()` copies the items of an `Array<Byte>` into a new `Binary`.
- `b.slice(start, end)` copies the bytes from `start` up to, but not including, `end` into a new `Binary`; it throws `slice out of range` unless `0 <= start <= end <= b.length`.

## Optional values

```
var name: String? = nil
print name ? 'nobody'
if const n = '42'.parse_int()
  print n + 1
```

- `T?` is a `T` or `nil`, where `T` is not itself optional: `T?` of an optional type, such as `Name?` after `type Name = String?`, is an error, since its nil would be ambiguous. A `T` or `nil` fits where a `T?` is expected. `nil` has no type of its own, so `const x = nil` needs a type (`const x: String? = nil`).
- `x!` is `x` without nil; it throws `unwrapped nil` if `x` is nil.
- `x ? fallback` is `x` without nil, or `fallback`, which has that type, if `x` is nil. The fallback is evaluated only then. `?` binds weaker than every other binary operator, and `a ? b ? c` is `a ? (b ? c)`.
- `x == nil` and `x != nil` test an optional value. `==` and `!=` also compare an optional value with another of its type, or with a value of its type without nil, wherever they compare the values themselves: two nils are equal, nil and a value are not, and two values compare as usual. An expected enum reaches the other operand through the optional (`kind == '('` for a `kind: TokenKind?`). The ordering operators (`<` and so on) do not take optional values.
- An optional value can be a condition (see [control flow](control-flow.md#if-and-while)).
- An array cannot hold optional `Int`, `Byte` or `Bool` values yet; optional references are fine (`Array<String?>`).
- `s.parse_int()` gives the `Int` that a `String` of decimal digits, with an optional leading `-`, stands for, or nil if it is anything else or does not fit in an `Int`.
- `b.decode_utf8()` gives the `Binary` as a `String` if its bytes are valid UTF-8, without copying them, or nil otherwise.

## Array

```
const xs = [3, 1, 2]
const names: Array<String> = []
names.push('a')
print xs[0] + xs.length
```

- `Array<T>` is a growable sequence of items of type `T`, which can be any type with values (not `void`). Arrays are mutable and shared: assigning or passing an array does not copy it.
- `[a, b, c]` makes an array (over several lines too: see [lines inside brackets](syntax.md#lines-inside-brackets)). Its item type comes from the expected type if there is one (a type annotation, a parameter, a return type), otherwise from the first item. `[]` needs an expected type.
- `xs[i]` reads an item and `xs[i] = value` replaces one (`+=` and so on work on `Int` items). An index outside `0 ... xs.length` throws `index out of range`.
- `xs.length` is the number of items.
- `xs.push(item)` appends an item. `xs.pop()` removes and returns the last one; on an empty array it throws `pop from an empty array`.
- `xs.iter()` gives an [`Iter`](#iter) of the items, and `xs.map(f)`, `xs.filter(f)` and `xs.take(n)` one of the items as it maps, filters or takes them.
- `strings.join(separator)` joins an `Array<String>` into one `String`.
- Arrays cannot be compared or printed.

## Map

```
const ages = { 'ann': 31, 'bob': 27 }
const squares: Map<Int, Int> = Map()
squares[3] = 9
print ages['ann'] ? 0
```

- `Map<K, V>` maps keys of type `K`, a `String`, an `Int`, an [enum](#enums), a class or a union of classes (compared by identity: see [equality](objects.md#classes-and-structs)), to values of type `V`, which can be any type with values except an optional one. Like arrays, maps are mutable and shared.
- `{ k: v, ... }` makes a map (over several lines too, as an array). Its types come from the expected type if there is one, otherwise from the first entry; of entries with the same key, the last one wins. Keys that are names make an [anonymous struct](#anonymous-structs) instead, and the two kinds cannot be mixed: to use a name's value as a key, put it in parentheses, `{ (k): v }`. The empty map is `Map()`, which needs an expected type.
- `m[k]` is the value of the key `k`, or nil if there is none, so its type is `V?`. `m[k] = v` adds the key or replaces its value. `+=` and so on do not apply, since the key may be missing.
- `m.length` is the number of keys, `m.has(k)` tells whether `k` is there and `m.remove(k)` removes it, if it is there.
- `m.keys()` is an `Array<K>` of the keys in the order they were first added (a key removed and added again counts as new).

## Iter

```
const squares = (x * x for x in 0...10 when x % 2 == 0)
for square in squares.take(3)
  print square
const shouts = ['hi', 'yo'].map((w) -> w + '!').to_array()
```

- `Iter<T>` is a lazy sequence of items of type `T`, which can be any type with values, an optional one too. It computes an item only when asked for it, so nothing happens until it is consumed; a statement that only makes an `Iter` is an error (see [discarded values](errors.md#discarded-values)).
- [Lazy comprehensions](control-flow.md#for-and-ranges) make one, and so do these methods of an array or an `Iter`, which take a function of an item:
  - `xs.map(f)` gives `f(x)` for each item `x`; its items have the type of `f`'s result.
  - `xs.filter(f)` gives the items for which `f`, which gives a `Bool`, is true.
  - `xs.take(n)` gives the first `n` items, or all of them if there are fewer (none if `n` is not positive).

  The `Iter` of an array reads the array as it goes, as a `for` does. The functions' parameter types may be left out, as in `(w) -> w + '!'`; `map`'s result type is that of its function.
- These methods of an array or an `Iter` search the items with a function of an item that gives a `Bool`, and stop reading at the first item that decides the result:
  - `xs.any(f)` tells whether `f` is true for some item, and `xs.all(f)` whether it is for every item (so `all` of no items is true).
  - `xs.find(f)` gives the first item for which `f` is true, or nil if there is none. Its type is `T?`, so for items of an optional type it is an error (see [optional values](#optional-values)).
- An `Iter` is consumed by `for`, by a comprehension over it, by `it.to_array()`, which gives its items as an array (of a `T` an array can hold), by `it.any`, `it.all` and `it.find`, and by `it.map`, `it.filter` and `it.take`, whose `Iter` reads it.
- `it.has_next()` tells whether there is an item left, and `it.next()` gives it; past the end, `next` throws `next past the end of an Iter`.
- **An `Iter` can be traversed only once.** Calling `has_next` or `next` traverses it, and so does any consumer above, which throws `an Iter can be traversed only once` if a traversal has started. To go through the items several times, keep them with `to_array()`.

## Methods

The methods of the builtin types are listed in [builtins](builtins.md#methods-of-the-builtin-types). A method must be called: `x.to_string` without `()` is an error.

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
- A member's value fits where the union is expected. A field that every member declares, with the same type in each, can be read from the union: `shape.name` reads the field of whichever member the value is. It can be assigned through the union, `shape.name = n` (and `+=` and so on), when every member is a class whose field is not `const`. Other fields and methods cannot be used directly: branch on its type first.
- `x is T` tells whether a union value holds a `T`; for an optional union value, whether it is not nil and holds a `T`. Like nil tests, it narrows a `const`, a parameter or a loop variable to `T` where it holds (see [control flow](control-flow.md#if-and-while)).

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
