# Syntax

- Source files use the extension `.lerta`. Lines end with LF or CRLF.
- Comments run from `#` to the end of the line. There are no block comments.
- Identifiers are `[A-Za-z_][A-Za-z0-9_]*` (ASCII only).

## Number literals

### Integer literals

- Decimal or hexadecimal. Both have the same types and limits (see [Int](types.md#int)).
- In a decimal one, `_` may separate digits (`1_000_000`).
- A leading zero is not allowed except in `0` itself, so `010` is not mistaken for octal.
- A hexadecimal one is `0x` followed by one or more digits `0-9`, `a-f` or `A-F`, with no `_`: `0xFF`, `0x7fffffffffffffff`.

### Float literals

- Decimal, with a fraction after `.`, an exponent after `e` or `E` with an optional sign, or both: `1.5`, `1e9`, `2.5E-3`.
- `_` may separate digits in each part.
- A `.` starts a fraction only before a digit or `_`. So `1.` is an error and `0..3` is a range (see [Float](types.md#float)), while `1._5`, and `0x1.5` after a hexadecimal one, are each one invalid number literal.
- Only a decimal literal has an exponent, so `0xE+1` is an addition.

### Negative literals

- Where a prefix `-` may appear, a `-` directly followed by a number literal is part of the literal: `-1`, `-1.5`. Otherwise it is the prefix operator.
- After an operand, `-` is always subtraction: `x-1`, `1 -1`.

## String literals

| Form | Lines | Escapes and interpolation |
|---|---|---|
| `'...'` | one | none; cannot contain `'` |
| `"..."` | one | yes |
| `'''` | several | none |
| `"""` | several | yes, each within a line |
| `b'...'`, `b"..."` | one | as `'...'` and `"..."` ([Binary](#binary-literals)) |

### Escapes and interpolation

- `"..."` has the escapes `\n` `\t` `\r` `\0` `\\` `\"` `\#`, and:
  - `\x41`, a byte in two hex digits, at most `\x7F`, as a `String` is UTF-8;
  - `\u{1F600}`, a code point in hex, not a surrogate.
- Interpolation `"#{expression}"` inserts the value's text, `expression.to_string()` (see [Stringable](builtins.md#stringable)).
- An interpolated expression cannot contain a function literal or a comment.

### Binary literals

- `b'...'` and `b"..."` are [Binary](types.md#binary) literals: the bytes that `'...'` and `"..."` write, with no space after the `b`. `b''` is the empty `Binary`.
- In `b"..."`, `\x00` to `\xFF` each write any byte.
- A `Binary` literal of one byte that interpolates nothing is a `Byte` where one is expected (see [Literals by context](types.md#literals-by-context)).
- An interpolated `Binary` inserts its bytes as they are; other values insert their text.
- A `Binary` literal is single line only: `a Binary literal spans one line`.

### Multiline literals

```lerta
name := 'app'
usage := """
  Usage:
    build "#{name}"
  """
```

This is `"Usage:\n  build \"app\"\n"`.

- The opening `"""` ends its line. The text is that of the lines after it, up to the closing `"""`, joined by line feeds.
- The closing `"""` may end the last line of the text, or stand on a line of its own after spaces, which keeps the line feed before it. With the closing `"""` at the end of the `build` line above, the text would end without the line feed.
- The first `"""` closes, so a text that ends with `"` before the closing `"""` writes it `\"`.
- The text leaves out the indentation that its lines share: the least number of leading spaces of the lines that are not blank, wherever the closing `"""` is.
- A blank line, of spaces only, is empty. A tab is never indentation, but text.
- The literal has the escapes and the interpolation of `"..."`, each within a line, and holds `"` and `""` as they are. `\"""` writes `"""`.
- A CRLF line end is a line feed.
- `'''` literals span lines and leave out the shared indentation as `"""` ones do, but have no escapes and no interpolation, as `'...'` has none. The first `'''` closes, and no text holds one.

## Indentation

- Indentation forms blocks. It is made of **spaces only**; a tab in indentation is a compile error.
- A line that is empty, or contains only spaces and optionally a comment, is ignored, whatever its indentation.
- A line indented less than the previous one must return to the indentation of an enclosing block.

## Continued lines

```lerta
total := first_operand_with_a_long_name +
  second_operand_with_a_long_name * third_operand_with_a_long_name * fourth_operand_with_a_long_name
doubled := xs.map((x) ->
  y := x * 2
  y + 1
)
```

- A line continues on the lines indented deeper than it when it ends where an operand or an item is to come: after an operator, a comma, `then`, `else` or an opening bracket, `(` `[` `{`. So `keywords := ['const', 'var',` continues with the items on the lines below it.
  - Those lines are a block of their own, laid out by indentation as any block, inside brackets too.
  - In that block, a line that ends where an operand is to come continues on the next line at its indentation: in `total := 1 +`, then `2 *` and `3` on two lines indented below it, the `3` continues `2 *`.
  - The `<` `>` of type arguments are not brackets.
- A line that continues the head of an `if`, a `while` or a `for` would be the block of its body. So a head that takes several lines does so inside brackets, whose closing bracket goes back to the head's indentation (`if f(`, the arguments, `) == 3`).

### Lists

In a list (the brackets of an array or a map, the parentheses of a call's arguments or of a function's parameters):

- A line end separates items as a comma does.
- Items on one line are separated by commas. A comma may also end a line, separating it from the next as the line end alone would.
- An item must follow a comma, so the last item does not end with one.
- An item, as any value, may take the lines below, as a function's body after `->`, a `case` or a `try` does. The item after it starts its line, or follows a comma that does.

### Grouping and indexes

- In grouping parentheses and an index, `xs[i]`, the lines continue the expression.
- A line end before the `default:` of a map's index separates it from the key as a comma does.
- A line there cannot start with `.` or `?.` to continue it with a member (see [member lines](#member-lines)), but one may start with the `for` or the `when` of a comprehension.

### Closing brackets

A closing bracket goes on the line of the last item, or at the start of the line after the block, at the indentation of the line that opened the brackets.

## Bracketless blocks

```lerta
config :=
  name: 'lerta'
  description: 'A compiled language with reference counting, generics and async functions'
  targets:
    'x86_64-unknown-linux-gnu'
    'aarch64-apple-darwin'
    'x86_64-w64-mingw32'
    'i686-w64-mingw32'
    'aarch64-unknown-linux-gnu'
draw
  'p'
  x: 10
  y: 20
  label: 'the starting point of the path, drawn before any of the other points are'
```

### Block literals

After a trailing `=` or `:=` (of a declaration, a destructuring one among them, an assignment or a field), a trailing `key:` or a `return`, an indented block on the next lines is a literal.

- Its items, one or more on each line separated by commas as in a list (`x: 10, y: 20`), decide its kind:

  | Items | Literal |
  |---|---|
  | all `name: value`, which a spread `p...` may start | an [anonymous struct](types.md#anonymous-structs) |
  | all `key: value`, with a key that is not a name | a map |
  | all plain values | an array |

- Mixing them is an error.
- A value may take the lines below, as an `if`, a `case` or a function literal does.
- A block of one plain value is that value itself, not an array of it, so that a value can start on the next line. An array of one item is written `[x]`.
- An array inside an array cannot be written without brackets.

### Arguments in a block

A callee followed by an indented block gives the block as the call's arguments, after those on its line: `draw` above is `draw('p', x: 10, y: 20, label: ...)`, and `draw 'p'` followed by a block of `x: 10` and `y: 20` is `draw('p', x: 10, y: 20)`. The callee is the name, `@name` or member of a [call without parentheses](#calls), or a call.

- It is written as a statement, or as a whole value where a block literal may be: after `=`, `key:` or a `return`, and as the operand of `throw` or `yield`.
- A callee inside an operation, as in `1 + f` or `await f`, takes no block.
- Its items are separated as a literal's are, with the positional arguments before the named ones (`name: value`, see [anonymous structs](types.md#anonymous-structs)), and `xs...` a spread. A key that is not a name is an error.
- A positional item is an expression, as on the line, that may take a block of arguments of its own and the member lines below it. An `if` is not one, but `c then a else b` is.
- Named arguments are all on the line or all in the block.

## Declarations and assignment

### Declarations

| Form | Declares |
|---|---|
| `name := value` | a const, a name that cannot be reassigned |
| `name: Type = value` | a const of the type written: `limit: Int? = 10` |
| `var name = value`, `var name: Type = value` | a `var`, one that can be reassigned: `var count = 0` |
| `var name: Type?` | a `var` of an optional type, nil: `var found: String?` |
| `var name: Type[]` | a `var` of an array, a map or a set, empty (below): `var xs: Int[]` |

- The type is the type of the value, or the one written after the name.
- `:=` after `var` is an error.
- A [destructuring](types.md#anonymous-structs) declares its names with `:=` too, and so does the condition of an `if` or a `while` that binds a name (see [control flow](control-flow.md#if-and-while)).
- The members of a class or struct are declared so too (see [members](objects.md#members)).
- A const or a `var` (not a field) whose type is written as an array, `Map<K, V>` or `Set<T>` (not optional, nor through an alias) may leave out its value. It is then empty, a new one each time the declaration runs: `names: String[]` is `names: String[] = []`, and `var seen: Set<String>` is `var seen = Set<String>()`.
  - A field does not, as one without a value is a constructor argument (see [members](objects.md#members)).
- Why: there is no `let` and no function declaration (`def`), so that declarations look the same at the top level and inside functions, for values and for functions.
  - `:=`, a written type or `var` tells a declaration from an assignment, which avoids the CoffeeScript ambiguity between them.
  - The most common declaration, of a name that is not reassigned, is the shortest.
  - A const only makes the binding immutable, since immutability of the contents is handled by types.

### Assignment

| Form | Assigns to |
|---|---|
| `name = value` | a `var` |
| `xs[i] = value` | an item of an array |
| `m[k] = value` | a value of a map |
| `c.name = value` | a `var` field of a class (see [mutability](objects.md#mutability)) |

- An assignment is a statement, not an expression.

### Compound assignment

- `+=` `-=` `*=` `/=` `%=` `&=` `|=` `^=` `<<=` `>>=` combine a target with a value as their binary operator does, for the types it takes (`Int`, `Byte` and `Float`; see [types](types.md)).
- `+=` also appends a `String` to a `String`.
- A map's value takes them only through a default, `m[k, default: 0] += 1` (see [Map](types.md#map)).
- The target, as an object and an index, is evaluated first, then the value, and then the target is read and combined with it. So `x += f()` adds to what `x` holds once `f` has run, if `f` assigns `x` too.

## Statements

- One statement per line, or several separated by `;`, which ends a statement as a line end does: `x := 1; print x`.
  - A `;` comes between two statements on its line, so none starts or ends a line, and none follows another.
  - A block does not start after one: `for x in xs; print x` is an error, but `print x for x in xs` is not.
  - None is inside brackets or in an interpolation.
  - It is for a program given on the command line (see [`-e`](compiler.md#run)); the style puts each statement on a line of its own (see [Semicolons](style.md#semicolons)).
- A statement is an expression; see [discarded values](errors.md#discarded-values) for which expressions may stand alone.

### Member lines

A line that starts with `.` or `?.` continues a value with a member, so a method chain may be split across lines.

```lerta
names := items
  .map((x) -> x.name)
  .to_array()

text :=
  'the first part of a long text'
  'the second part of the same long text'
  'the third part'
.join(' ')
```

- The value is that of a declaration, an assignment, an item of a [bracketless block](#bracketless-blocks), a statement, or the operand of `return`, `throw` or `yield`.
- The lines are one level deeper than the line where the value starts, as `.map(f)` under `names := items`; or at its indentation, as `.join(' ')` above, which a value that ends with a block takes, whose lines the deeper ones would be.
- The member applies to the whole value, however many lines it takes: `a + b` and then `.text` on the next line is `(a + b).text`, as `.join(' ')` above applies to the block. So it applies to a statement's: `print items` and then `.length` below it is the length of what `print` gives, not of `items`.
- The line holds members only. An operator after them, as in `.length + 1`, is an error, and so are arguments without parentheses, as in `.push x`, since the line does not start a statement (see [calls](#calls)).
- A statement may still go on to an assignment: `p` and then `.x = 1` on the next line assigns to `p.x`.
- Where several such values start on that line, the line continues the innermost one that ends before it:
  - after `g := (x) -> x`, the body `x`, as after `when 1 then 'a'` the value `'a'`;
  - a function literal whose body takes the lines below ends there, so the member applies to the function.
- Inside brackets, the lines are items instead (see [continued lines](#continued-lines)).
- The line is an error after `break` or `continue`, and after a statement that ends with a block, such as an `if`, or with [arguments in a block](#arguments-in-a-block).
- A value that ends with arguments in a block takes it, as it takes one after a literal.

### pass

`pass` alone is a body that does nothing, which is `void`:

- a block's only statement, as of a function, a `catch`, an `if` or a loop;
- an arm's or a function literal's on its line: `else pass`, `noop := -> pass`;
- the body of a class or a struct without members, which declares one that has none.

`pass` is not a keyword: among other statements it is a name, and only there may a value of that name be read.

## Calls

- `f(x, y)` calls `f`. The `(` must follow the callee without whitespace.
- Arguments may be named, `f(name: value)`, after the positional ones: those of a constructor, and those of a last struct or [anonymous struct](types.md#anonymous-structs) parameter (see [functions](functions.md#a-last-struct-parameter)).
- `x.name()` calls a method of `x`, `x.name` reads a property and `xs[i]` indexes. A map's index may name a default after the key, `m[k, default: d]`.
- As with `(`, no space is allowed before `.` or `[`. At the start of a statement, `f [1]` is the call `f([1])`.
- `(x)` groups an expression.
- Parsing is decided purely by syntax. If `f` is not a function, the type checker rejects it.

### Calls without parentheses

`f x, y` (the Nim command syntax approach). The callee is a name or `@name`, followed by any number of `.name`, all without spaces: `xs.push x`, `@lines.push line`.

1. Allowed **only at the start of a statement**. In the middle of an expression (`g(f x)`), parentheses are required.
2. Arguments are taken **greedily to the end of the line**, or to a postfix `if`, `unless`, `while`, `until` or `for`, which applies to the whole call: `print x if done` is `(print x) if done`, while `f a then b else c` passes `a then b else c`.
3. There are no nested parenthesis-free calls: `f g x` is an error; write `f g(x)`.
4. At the start of a statement, whitespace after the callee marks the start of the arguments: `f (a), b` is `f((a), b)`, while `f(a)` is a call with parentheses.
   - `f -1` is `f(-1)`. With whitespace after the operator too, as in `f - 1`, it is a binary operator.
   - In the middle of an expression there are no parenthesis-free calls, so `x -1` is `x - 1`.
5. **A call with zero arguments requires parentheses**: `f()`. A bare `f` is the function value.
6. If the last argument is a function literal, its body may continue as an indented block on the next lines, `each xs, (x) ->` followed by the body, as it may in parentheses (see [continued lines](#continued-lines)).

## Types

- Types are written as names, with type arguments in `<>`, `[]` for an array and `?` for an optional type: `Int`, `Map<String, Int>`, `String[]`, `String?`.
- `[]` and `?` apply in the order they are written: `Int[]?` is an optional array.
- A function type or a union is in parentheses to be an array's items: `((Int) -> Int)[]`, `(A | B)[]`.
- A union is optional where a member is, `A | B?`, or in parentheses with `?` after them, `(A | B)?`.

## Operators

### Precedence

From weakest to strongest:

| Operators | Associativity |
|---|---|
| `then`/`else` | right |
| `or` | left |
| `and` | left |
| prefix `not` | - |
| comparisons: `==` `!=` `<` `<=` `>` `>=`, `is`, `as`, `in` | none |
| `?` (nil coalescing) | right |
| ranges `..` `..=` | none |
| `+` `-` `\|` `^` | left |
| `*` `/` `%` `&` `<<` `>>` | left |
| prefix `-` | - |

- Arithmetic and bitwise operators are left-associative: `10 - 4 - 3` is `3`.
- They bind tighter than comparisons: `x & 0xF == 0` compares `x & 0xF`.
- `a then x else b then y else z` is `a then x else (b then y else z)`.
- Comparisons, `is`, `as` and `in` included, do not chain: `a < b < c` is a syntax error; use parentheses, as in `(x as T?) == nil`.
- `as` binds as comparisons do, weaker than `.`: a member of a cast is read as `(x as T!).name`.

### Postfix operators

- `x!` unwraps an optional value; no space is allowed before `!`.
- `x?.name` reads a member of an optional value (see [optional values](types.md#optional-values)); no space is allowed before `?` or `.`.

### Angle brackets

- `<<` and `>>` are each two `<` or `>` with no space between them, so that `Map<String, Set<Int>>` ends with two closing brackets.
- A `<` right after a name, without a space, starts type arguments where a `>` right before a `(` closes a list of types: `f<Int>(x)` is a call with type arguments, and so is `a<b, c>(d)` in `f(a<b, c>(d))`, which passes one argument.
- Two comparisons are written with spaces: `f(a < b, c > d)`.

### in

- `x in xs` tells whether `xs` contains `x`, by `xs.contains(x)` (see [Contains](builtins.md#contains)).
  - `x` is evaluated first, as written.
  - `x` is not optional unless `contains` takes nil.
  - An array literal `xs` may take its item type from `x`, as [Byte](types.md#byte) says when.
- `x not in xs` is `not (x in xs)`.
- `x in a..b` and `x in a..=b` compare `x` with the ends: `c in 0x20..=0x7e`, `c in 'a'..='z'`.
  - `x` is evaluated first, and each of the three once.
  - The three take one type, as the operands of `<=` do.
  - `x` is a number or a `Char`, so far.

### Nesting limit

- An expression or a type nests at most 500 deep. Deeper is a compile error, `nesting deeper than 500`, so that the compiler does not overflow its stack.
- Each of these counts as one level: a bracket, an interpolation, a prefix operator, `then`/`else`, `?`, a type argument or `[]`, and each operator, call, index or member of a chain, as `1 + 2 + 3` or `a.b.c`.
- Each `else if` of a chain counts as one level too, for the conditions and blocks after it as well.
- Indented blocks are not counted, as their indentation makes the source grow with the square of their depth.

## Forms of other languages

What another language writes and Lerta spells otherwise is an error that says what to write:

- `&&`, `||` and a prefix `!` for `and`, `or` and `not`;
- `x ?? d` for `x ? d`, and `c ? a : b` for `c then a else b`;
- `let x = v` for `x := v`, and an assignment to a name declared nowhere for `x := v` or `var x = v`;
- `null`, `None` and `undefined` for `nil`;
- a `String`'s `length`, as a property or a method, for `count()` or `byte_count()`.

## Keywords

`true` `false` `nil` `and` `or` `not` `var` `if` `else` `while` `unless` `until` `for` `break` `continue` `return` `case` `then` `class` `struct` `throw` `import` `export` `extern` `intrinsic` `extend` `enum` `interface` `try` `catch` `finally` `yield` `await` are keywords and cannot be used as names.

### Contextual words

These words are not keywords. Each acts as one only where it is written so, and stays usable as a name elsewhere.

| Word | Where it acts as a keyword |
|---|---|
| `at`, `in`, `when` | after the variables of a `for` (`for x at i in xs when c`, also in comprehensions), and `when` at the start of a `case` arm; so `for x in in` reads a variable `in` |
| `pass` | alone as a body (see [pass](#pass)) |
| `is`, `as`, `in`, `not in` | after an operand (see [unions](types.md#unions) and [operators](#operators)), so that a call without parentheses does not start with one of them as a name: `print(in)` |
| `as` | also in an [import](modules.md), an [export](modules.md#exports) or an [extern](functions.md#c-functions) |
| `from` | in an [import](modules.md) or an [export](modules.md#exports) |
| `type` | before an alias's name and `=` (see [unions](types.md#unions)) |
| `default` | before an operand in a field (see [members](objects.md#members)): `default -1` is a default, and `default - 1` a subtraction |
| `weak` | before a function literal, a field or a declaration (`name :=`, `name:` or `var`) (see [weak function literals](functions.md#weak-function-literals), [weak fields and locals](objects.md#weak-references)); a function named `weak` is called with parentheses |
