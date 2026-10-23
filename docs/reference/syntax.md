# Syntax

- Source files use the extension `.lerta`. Lines end with LF or CRLF.
- Comments run from `#` to the end of the line. There are no block comments.
- Identifiers are `[A-Za-z_][A-Za-z0-9_]*` (ASCII only).
- Integer literals are decimal or hexadecimal. In a decimal one, `_` may separate digits (`1_000_000`), and a leading zero is not allowed except in `0` itself, so `010` is not mistaken for octal. A hexadecimal one is `0x` followed by one or more digits `0-9`, `a-f` or `A-F`, with no `_` (`0xFF`, `0x7fffffffffffffff`). Both have the same types and limits (see [Int](types.md#int)). Where a prefix `-` may appear, a `-` directly followed by an integer literal is part of the literal (`-1`); otherwise it is the prefix operator. After an operand, `-` is always subtraction (`x-1`, `1 -1`).
- Float literals are decimal, with a fraction after `.`, an exponent after `e` or `E` with an optional sign, or both: `1.5`, `1e9`, `2.5E-3`. `_` may separate digits in each part. A `.` starts a fraction only before a digit or `_`, so `1.` is an error and `0...3` is a range (see [Float](types.md#float)), while `1._5`, and `0x1.5` after a hexadecimal one, are each one invalid number literal. Only a decimal literal has an exponent, so `0xE+1` is an addition. A `-` joins a float literal as it joins an integer one (`-1.5`).
- `'...'` string literals have no escapes and no interpolation. They are single line only and cannot contain `'`.
- `"..."` string literals are single line and have escapes, `\n` `\t` `\r` `\0` `\\` `\"` `\#` and `\u{1F600}` (a code point in hex, not a surrogate), and interpolation `"#{expression}"`, which inserts the value's text, `expression.to_string()` (see [Stringable](builtins.md#stringable)). An interpolated expression cannot contain a function literal.
- `"""` string literals span lines. The opening `"""` ends its line, and the text is that of the lines after it, up to the closing `"""`, joined by line feeds. The closing `"""` may end the last line of the text, or stand on a line of its own after spaces, which keeps the line feed before it:

  ```
  name := 'app'
  usage := """
    Usage:
      build "#{name}"
    """
  ```

  This is `"Usage:\n  build \"app\"\n"`; with the closing `"""` at the end of the `build` line, it would end without the line feed. The first `"""` closes, so a text that ends with `"` before the closing `"""` writes it `\"`. The text leaves out the indentation that its lines share: the least number of leading spaces of the lines that are not blank, wherever the closing `"""` is. A blank line, of spaces only, is empty. A tab is never indentation, but text. The literal has the escapes and the interpolation of `"..."`, each within a line, and holds `"` and `""` as they are; `\"""` writes `"""`. A CRLF line end is a line feed.
- `'''` string literals span lines as `"""` ones do, and leave out the indentation that their lines share as those do, but have no escapes and no interpolation, as `'...'` has none: the first `'''` closes, and no text holds one.

## Indentation

- Indentation forms blocks. It is made of **spaces only**; a tab in indentation is a compile error.
- A line that is empty, or contains only spaces and optionally a comment, is ignored, whatever its indentation.
- A line indented less than the previous one must return to the indentation of an enclosing block.

## Lines inside brackets

```
keywords := [
  'const'
  'var', 'if',
  'else'
]
print add(
  1
  2
)
total := (1 +
  2)
doubled := xs.map((x) ->
  y := x * 2
  y + 1
)
```

- Lines inside brackets, `(` `[` `{`, continue the line that opened them, whatever their indentation, until the brackets close. The `<` `>` of type arguments are not brackets.
- In a list (the brackets of an array or a map, the parentheses of a call's arguments or of a function's parameters), a line end separates items as a comma does. Items on one line are separated by commas, and a comma may also end a line, separating it from the next as the line end alone would. An item must follow a comma, so the last item does not end with one.
- In grouping parentheses and an index, `xs[i]`, lines simply continue the expression; a line there cannot start with `.` or `?.` to continue it with a member (see [statements](#statements)).
- A line inside brackets that ends with `->`, followed by a line indented deeper than it, opens the function's body as an indented block, laid out as any block, `case`s, loops and brackets of its own inside it. A line no deeper than the one with `->` ends the block, and continues the brackets, whatever it starts with (`)`, the next item); so does a closing bracket of the brackets around the block, wherever it is in the block, as on the line of its last statement (`  y + 1)`). A comma cannot follow such a body, so an item that holds one is the last on its line. No other item inside brackets opens a block: a `case` as an argument goes in such a function, or before the call under a name.

## Bracketless blocks

```
config :=
  name: 'lerta'
  targets:
    'linux'
    'macos'
draw 'p'
  x: 10
  y: 20
total := sum
  1, 2
  3
```

- After a trailing `=` or `:=` (of a declaration, a destructuring one among them, an assignment or a field), a trailing `key:` or a `return`, an indented block on the next lines is a literal. Its items, one or more on each line separated by commas as inside brackets, decide its kind: all `name: value` make an anonymous struct, all `key: value` (a key that is not a name) a map, and all plain values an array. Mixing them is an error. A value may take the lines below, as an `if`, a `case` or a function literal does. A block of one plain value is that value itself, not an array of it, so that a value can start on the next line; an array of one item is written `[x]`.
- **Arguments in a block.** A callee, the name, `@name` or member of a [call without parentheses](#calls), or a call, followed by an indented block, gives the block as the call's arguments, after those on its line: `sum` above is `sum(1, 2, 3)`, and `draw 'p'` is `draw('p', x: 10, y: 20)`. It is written as a statement, or as a whole value where a block literal may be, after `=`, `key:` or a `return`, and as the operand of `throw` or `yield`; a callee inside an operation, as in `1 + f` or `await f`, takes no block. Its items are separated as a literal's are, with the positional arguments before the named ones (`name: value`, see [anonymous structs](types.md#anonymous-structs)), and `xs...` a spread; a key that is not a name is an error. A positional item is an expression, as on the line, that may take a block of arguments of its own and the member lines below it; an `if` is not one, but `c then a else b` is. Named arguments are all on the line or all in the block. An array inside an array cannot be written without brackets.

## Declarations and assignment

- `name := value` declares a const, a name that cannot be reassigned, and `var name = value` a `var`, one that can. The type is the type of the value, or the one written after the name, after which a const takes `=`: `limit: Int? = 10`, `var xs: Int[] = []`. A [destructuring](types.md#anonymous-structs) declares its names with `:=` too, and so does the condition of an `if` or a `while` that binds a name (see [control flow](control-flow.md#if-and-while)). `const` before a declaration is an error, as it declares a [field](objects.md#classes-and-structs) alone, and so is `:=` after `var`. In a class or struct body, `name: Type = value` declares a field, which is a `var` in a class (see [mutability](objects.md#classes-and-structs)). A `var` of an optional type may leave out its value, which is then nil: `var found: String?`. A const (not a field) whose type is written as an array, `Map<K, V>` or `Set<T>` (not optional, nor through an alias) may leave out its value, which is then empty, a new one each time the declaration runs: `names: String[]` is `names: String[] = []`, and `seen: Set<String>` is `seen := Set<String>()`.
- `name = value` assigns to a `var`, `xs[i] = value` to an item of an array, `m[k] = value` to a value of a map and `c.name = value` to a field of a class that is not `const` (see [mutability](objects.md#classes-and-structs)).
- `+=` `-=` `*=` `/=` `%=` `&=` `|=` `^=` `<<=` `>>=` combine a target with a value as their binary operator does, for the types it takes (`Int`, `Byte` and `Float`; see [types](types.md)), and `+=` also appends a `String` to a `String`. A map's value takes none of them (see [Map](types.md#map)). The target, as an object and an index, is evaluated first, then the value, and then the target is read and combined with it, so that `x += f()` adds to what `x` holds once `f` has run, if `f` assigns `x` too.
- An assignment is a statement, not an expression.
- Why: there is no `let` and no function declaration (`def`), so that declarations look the same at the top level and inside functions, for values and for functions. `:=`, a written type or `var` tells a declaration from an assignment, which avoids the CoffeeScript ambiguity between them, and the most common declaration, of a name that is not reassigned, is the shortest. A const only makes the binding immutable, since immutability of the contents is handled by types.

## Statements

- One statement per line. A statement is an expression; see [discarded values](errors.md#discarded-values) for which expressions may stand alone.
- A line that starts with `.` or `?.` continues a value with a member, so a method chain may be split across lines. The value is that of a declaration, an assignment, an item of a [bracketless block](#bracketless-blocks), a statement, or the operand of `return`, `throw` or `yield`; the line has the indentation of the line where the value starts. The member applies to the whole value, however many lines it takes: `a + b` and then `.text` on the next line is `(a + b).text`, as `.join('')` applies to a block:
  ```
  text :=
    'a'
    'b'
  .join('')
  ```
  The line holds members only: an operator after them, as in `.length + 1`, is an error, and so are arguments without parentheses, as in `.push x`, since the line does not start a statement (see [calls](#calls)). A statement may still go on to an assignment: `p` and then `.x = 1` on the next line assigns to `p.x`. Where several such values start on that line, the line continues the innermost one that ends before it: after `g := (x) -> x`, the body `x`, as after `when 1 then 'a'` the value `'a'`, while a function literal whose body takes the lines below ends there, so the member applies to the function. Inside brackets, the lines are items instead (see [lines inside brackets](#lines-inside-brackets)). After `break` or `continue`, and after a statement that ends with a block, such as an `if`, or with [arguments in a block](#bracketless-blocks), the line is an error; a value that ends with arguments in a block takes it, as it takes one after a literal.

## Calls

- `f(x, y)` calls `f`. The `(` must follow the callee without whitespace.
- **Calls without parentheses** (the Nim command syntax approach): `f x, y`. The callee is a name or `@name`, followed by any number of `.name`, all without spaces: `xs.push x`, `@lines.push line`.
  1. Allowed **only at the start of a statement**. In the middle of an expression (`g(f x)`), parentheses are required.
  2. Arguments are taken **greedily to the end of the line**, or to a postfix `if`, `while` or `for`, which applies to the whole call: `print x if done` is `(print x) if done`, while `f a then b else c` passes `a then b else c`.
  3. There are no nested parenthesis-free calls. (`f g x` is an error; write `f g(x)`.)
  4. At the start of a statement, whitespace after the callee marks the start of the arguments: `f (a), b` is `f((a), b)`, while `f(a)` is a call with parentheses. `f -1` is `f(-1)`; if there is also whitespace after the operator, as in `f - 1`, it is a binary operator. In the middle of an expression there are no parenthesis-free calls, so `x -1` is `x - 1`.
  5. **A call with zero arguments requires parentheses**: `f()`. A bare `f` is the function value.
  6. If the last argument is a function literal, its body may continue as an indented block on the next lines: `each xs, (x) ->` followed by the body. With parentheses it cannot, as an item inside brackets cannot open a block (see [lines inside brackets](#lines-inside-brackets)); give the arguments in a block instead (see [arguments in a block](#bracketless-blocks)).
- Parsing is decided purely by syntax. If `f` is not a function, the type checker rejects it.
- `(x)` groups an expression.
- Arguments may be named, `f(name: value)`, after the positional ones: those of a constructor and the fields of an [anonymous struct](types.md#anonymous-structs) parameter.
- `x.name()` calls a method of `x`, `x.name` reads a property and `xs[i]` indexes. As with `(`, no space is allowed before `.` or `[`. At the start of a statement, `f [1]` is the call `f([1])`.
- Types are written as names, with type arguments in `<>`, `[]` for an array and `?` for an optional type: `Int`, `Map<String, Int>`, `String[]`, `String?`. `[]` and `?` apply in the order they are written, `Int[]?` being an optional array; a function type or a union is in parentheses to be an array's items, `((Int) -> Int)[]`, `(A | B)[]`.
- `x!` unwraps an optional value; no space is allowed before `!`. `x?.name` reads a member of an optional value (see [optional values](types.md#optional-values)); no space is allowed before `?` or `.`.

## Operators

From weakest: `then`/`else` < `or` < `and` < prefix `not` < comparisons (`==` `!=` `<` `<=` `>` `>=`, `is` and `as`) < `?` (nil coalescing) < range `...` < `+` `-` `|` `^` < `*` `/` `%` `&` `<<` `>>` < prefix `-`.

- Arithmetic and bitwise operators are left-associative (`10 - 4 - 3` is `3`). As they bind tighter than comparisons, `x & 0xF == 0` compares `x & 0xF`. `<<` and `>>` are each two `<` or `>` with no space between them, so that `Map<String, Set<Int>>` ends with two closing brackets. `then`/`else` and `?` are right-associative: `a then x else b then y else z` is `a then x else (b then y else z)`.
- Comparisons, `is` and `as` included, cannot be chained: `a < b < c` is a syntax error; use parentheses, as in `(x as T?) == nil`.
- `as` binds as comparisons do, weaker than `.`: a member of a cast is read as `(x as T!).name`.
- `true` `false` `nil` `and` `or` `not` `const` `var` `if` `else` `while` `for` `break` `continue` `return` `case` `then` `class` `struct` `throw` `import` `export` `extern` `extend` `enum` `interface` `try` `catch` `finally` `yield` `await` are keywords and cannot be used as names. These words are not keywords, and act as one only where they are written so, staying usable as names elsewhere:
  - `in` and `when` after the variables of a `for` (`for x in xs when c`, also in comprehensions) and `when` at the start of a `case` arm, so `for x in in` reads a variable `in`;
  - `pass` alone as an arm's body (see [case](control-flow.md#case-without-a-subject));
  - `is` and `as` after an operand (see [unions](types.md#unions)), and `as` in an [import](modules.md), an [export](modules.md#exports) or an [extern](functions.md#c-functions);
  - `from` in an [import](modules.md) or an [export](modules.md#exports);
  - `type` before an alias's name and `=` (see [unions](types.md#unions));
  - `default` before an operand in a field (see [members](objects.md#classes-and-structs)): `default -1` is a default, and `default - 1` a subtraction;
  - `weak` before a function literal, a field or a declaration (`name :=`, `name:` or `var`) (see [weak function literals](functions.md#function-literals) and [weak fields and locals](objects.md#classes-and-structs)), and `weak!` before a field; a function named `weak` is called with parentheses.
