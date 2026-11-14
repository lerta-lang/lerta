# Style

- The compiler does not check these conventions.
- [`lerta fmt`](compiler.md#fmt) checks and fixes them, except those that [the roadmap](../roadmap/programs.md#tools) lists as not applied yet.

## Names

### Naming

| Kind | Case |
|---|---|
| Variables, functions, methods, fields, module names | `snake_case` |
| Types, classes, interfaces | `PascalCase` |
| A `const` whose value is a literal (`MAX_SIZE := 100`), an enum member | `SCREAMING_CASE` |
| A `const` holding a computed result | `snake_case`, as an ordinary variable |

- This matches C names imported through FFI naturally.

### Unused names

- Name an unused variable `_`.
- Do not import a name that the module does not use.

### Removal

- Name an operation that takes something out `remove`.
- An `add` or a `remove` that may do nothing tells whether it did, as a `Bool`.

### Operator methods

- A method that defines an operator keeps the name that its interface gives it (`bit_or` for `|`, see [operators](builtins.md#operators)), and is called by the operator.

## Literals

### String literals

- Use `'...'` whenever it can be written with `'...'`.
- A `"""` literal stays as it is written, though `'''` could write it.
- The lines of a `"""` or `'''` literal after its first are one level deeper than the line that it starts on, keeping their indentation relative to each other. A blank one is empty.

### Binary literals

- Write `b'...'` or `b"..."`, not the bytes of a string literal, `'...'.binary`.
- `b'...'` too whenever it can be written with `'...'`.

### Escapes

In a literal, and in the lines of a `"""` literal but its interpolations:

- An ASCII character that is visible is written as it is, but `"`, `\` and `#`.
- Another ASCII character is written as its short escape, such as `\n` or `\"`, or as `\xHH`, not as `\u{...}`.
- `\u{...}` is for the other characters.

### Multi-line literals

- A literal that fits on its line goes there, in its brackets.
- One that does not, where it can be written without brackets, is written without them, the names of an import included.
- Where only a member call after the closing bracket keeps them, put it on the line after the block (`.join()`).
- A function returning one ends with `return` and the block, since a body is not a literal.

## Lines and spacing

### Layout

- Indent by two spaces for each level.
- The lines inside brackets are one level deeper than the line that opens them. The closing bracket goes back to that line's level, at the start of a line.
- The closing brackets of brackets opened on one line share a line (`])`).
- What follows a closing bracket stays on its line, but a member, which goes on a line of its own (see [Multi-line literals](#multi-line-literals)).
- No line ends with whitespace. Lines end with LF, and a file ends with one.

### Line length

- Up to 100 columns per line, comments and strings included.
- Break a comment over lines of their own, and a long string into literals joined by `+` (see [String](types.md#string)). Name a part of an operation that does not fit (see [Long operations](#long-operations)).

### Blank lines

- At most one in a row.
- One before a comment on a line of its own, which starts a paragraph, before a statement or a member of a type, at the end of a block or at the end of the file; but not at the start of a block, after another such comment, or before an item, an argument, an arm or a clause (`when`, `else`, `catch`, `finally`) at its depth.
- A comment covers its paragraph, up to the next blank line, which you put after the code that it covers.

### Spacing

One space:

- on each side of a binary operator: those of [operators](syntax.md#operators) but `..` and `..=`, the words among them included;
- on each side of `=` and the compound assignments (`+=`);
- on each side of `->`, but after an opening bracket or at the start of a line (`(-> x)`);
- after a comma, after every `:` and after `not`.

None:

- around the `..` or `..=` of a range or the `...` of a spread (`0..n`, `xs...`);
- inside `()` and `[]`;
- inside the `<>` of type parameters and arguments, or before one that follows a name or `extend` (`Map<K, V>`, `extend<K, V> Map<K, V>`), though the syntax allows a space there;
- before the `[]` of an array type (`Int[]`);
- around a `.` or a `?.` inside a line;
- before a postfix `!`, before the `?` of an optional type, before a comma or a `:`;
- between a callee and its `(`; a call without parentheses keeps one after its callee: `f (a), b`;
- after a unary `-` or `@` (`@x`).

### Inside `{}`

- Put spaces in an anonymous struct, a map and their types (`{ x: 0, y: 1 }`), but not in an interpolation (`#{x}`).

### Comments

- Their text is kept as it is written.
- One that ends a line follows two spaces.
- One that ends the line of `=`, `:=`, `return`, `then`, `else` or a key puts the value on the next line, deeper.
- These are reported for you to move, and their statement kept as it is written:
  - one that ends the line of `not`, `not in`, or a `(` or a `-` before an operand, rather than of a call or between operands;
  - one before the `weak` of a function literal, before its type parameters or its parameters, or before the `->` that starts one without parameters.
- One on a line of its own is indented as the line of code after it, or as the one before it where its column in the source is greater than that of the line after it (as at the end of a block), or where no line follows it.

### Long operations

- An operation that does not fit on its line, but whose first operand and operator do, breaks after each operator of its chain, the operations of its level on its left (`a +`, `b +`, `c`). The operands after the first go on lines of their own, one level deeper.
- A value after `=`, `:=` or `key:` in a block that does not fit on its line goes on the next line, one level deeper, if it fits there. Otherwise it breaks on its line if its first line fits there, and else on the next line.
- A union of a `type` written on more than one line below `=` keeps those lines, one level deeper, as the author grouped its members on them.
  - A line of it that does not fit breaks before the first member that does not fit on it, which starts a line of its own; so does a union on the line of `=` that fits on no line, which goes on the lines below `=`.
- These stay on one line:
  - an operation that is an operand of another outside brackets;
  - one in parentheses, whose `)` would end its last line;
  - one in the head of a block (`if`, `while`, `for`, `case` and its patterns), whose lines below are the block.
- Name a part of one that still does not fit (`product := b * c * d`, then `a + product`), by hand: `lerta fmt` reports the line.
  - Why not break it inside the operand: `a +` over `b * c *` and `d` reads as if `a + b * c` came first.

### Long chains

- A chain of two or more members (`items.map(f).to_array()`) goes on one line if it fits, and otherwise each member goes on a [member line](syntax.md#member-lines) of its own, one level deeper than the line where the chain starts. A value that is one breaks on the line of its `:=`, rather than going below it.
  - Why: a member a line reads as the steps it takes, which a line broken inside the arguments of one of them hides.
- These stay on one line:
  - a chain after a literal in a block, whose members go on the line after the block (see [Multi-line literals](#multi-line-literals));
  - one with `?.`, whose rest is in the `?.`, not after the value so far, as a member line would be;
  - one that ends with arguments without parentheses, which follow its last member; a member line after them, which applies to the call's value, stays one, one level deeper than the call's line, and keeps them on the call's line, which is reported if it does not fit, and keeps a function body that ends with it below its `->`;
  - one inside brackets, whose lines are items, or in the arguments of a call without parentheses, which go below the call instead;
  - one in the head of a block, whose lines below are the block, as an operation there does;
  - one that is an operand, as of `.length + 1`, which no member line can be followed by, or the target of an assignment;
  - one in parentheses, whose `)` would end its last line.

### Long lists

A list is parameters, arguments, an index, the items of an array or a map, the names of an import, or the patterns of a `when`.

- A list that does not fit on one line goes on lines of its own inside the brackets, or in a bracketless block:
  - for patterns, the [block of `when`](control-flow.md#case-with-a-subject), with `then` on the line after it;
  - for the arguments of a call that is a statement or a whole value on a line of its own, [a block below the callee](syntax.md#bracketless-blocks), if the callee is one of a [call without parentheses](syntax.md#calls) and the call has no type arguments.
- Each line holds as many items as fit when every item is simple: a name, a short literal, a parameter `name: Type`, `name: value` with such a value, or a pattern.
- Otherwise each item, as a call or an operation, or one that stands for a line of text, goes on a line of its own (see [continued lines](syntax.md#continued-lines)).
- A line holding several items ends with a comma, except the last line of the list. A line holding one item does not.
  - Why: a comma and a line end would look like two kinds of separator.
- A function whose body takes lines of its own inside brackets ends the list on the line where the brackets open if it is the last item, with the closing bracket on a line of its own (`xs.map((x) ->`, the body, `)`). Otherwise each item goes on a line of its own.
- A `"""` or `'''` literal before the last item ends its line with its closing quotes, which nothing follows: each item goes on a line of its own. After `=`, `:=` or `key:`, a literal of items that holds one, last or not, goes in a block (see [Multi-line literals](#multi-line-literals)).

## Expressions

### Calls without parentheses

- Call a function or a method without parentheses at the start of a statement on a line of its own whose value is dropped (`write_group writer, item, indent`, `xs.push x`), wherever the language allows it (see [calls](syntax.md#calls)).
- Keep them on a call whose value is the result of its function: the last statement of the body, or of an arm of one that is (`parse(text)`), but not of a function of no value, which drops it. So a call without them never gives a value that is used. In a program that does not check, whose results are not known, `lerta fmt` takes them off every call at the start of a statement, as it cannot tell the results without the types.
- On the line of an arm or of a function literal, keep the parentheses (`when Call then generate_call(g, expression)`, `-> Group(fields)`).

### Shorthand

- When the value of a named argument or a field is a variable of the same name, write the name alone: `Point(x, y: 2)`, `{ a }`.

### Values alone

- Construct a value of one argument that must be given with that argument alone: `ValueError('bad')`, not `ValueError(message: 'bad')`.

### Destructured values

- Take a value apart itself, `(key, value) := s.split_once('=') ? return`, not through a const that holds it only for that: `parts := s.split_once('=') ? return` followed by `(key, value) := parts`. So for `{ a, b } := value`.

### Spreads

- Construct a value from another of its type with a spread, `Point(p..., x: 1)`, not by copying its fields one by one, `Point(x: 1, y: p.y, z: p.z)`.

### Expected types

- Where an enum is expected, write its member alone (`kind == INTEGER`, not `kind == TokenKind.INTEGER`; see [enums](types.md#enums)), unless a name in scope takes the member's name.
- Where a struct is expected, construct it with `{}` (`points: Point[] = [{ x: 1 }, { x: 2 }]`, not `[Point(x: 1), Point(x: 2)]`; see [anonymous structs](types.md#anonymous-structs)).
- Write a type once where the values that give it would each name it: for a variable, a field or a function whose array items, branches or results are members of an enum or constructions of a struct, write the type, and the values as above (`color: Color = flag then RED else BLUE`, not `color := flag then Color.RED else Color.BLUE`; `(n: Int): Point -> n == 0 then { x: 0 } else { x: n }`). Not for one such value alone, but for an array of a struct, as a record is shorter than its construction (`points: Point[] = [{ x: 1 }, origin()]`).
- Do not import an enum or a struct only to name its members or to construct it.

### Parentheses

- Do not write parentheses that change nothing, except:
  - where another rule asks for them ([Ranges](#ranges));
  - to clarify `and` mixed with `or`;
  - around a `then`/`else` inside the `then` value of another (`a then (b then x else y) else z`), whose `else`s are hard to pair otherwise.

### Ranges

- Parenthesize an end that is an operation (`0..(n - 1)`) for readability. `..` and `..=` bind weaker than arithmetic, so the parentheses do not change the meaning.
- Write `a..=b`, not `a..(b + 1)`, of integers.
- Leave out the ends of an index that are its bounds: `xs[..n]`, not `xs[0..n]`, and `xs[i..]`, not `xs[i..xs.length]`.

### Cast fallbacks

- Write `x as T ? y`, not `(x as T?) ? y`.

### Redundant casts

- Do not cast a value to the type it has: after `if shape is Point`, write `shape.x`, not `(shape as Point!).x`.

### Else nil

- Without `else`, `then` gives nil, so leave out `else nil`: `name then greet(name)`, not `name then greet(name) else nil`.

### Emptiness tests

- Write `xs.is_empty()`, not `xs.length == 0`.
- Write `not xs.is_empty()`, not `xs.length > 0` or `xs.length != 0`.
- For a `String`, write `s.is_empty()`, not `s == ''`.

### Char concatenations

- Add a `Char` to a `String` itself: `text += c`, not `text += c.to_string()`.

### Found tests

- Write `xs.any(f)`, not `xs.find(f) != nil`, and `not xs.any(f)`, not `xs.find(f) == nil`.

### Default comparisons

- Write `xs.sorted()`, not `xs.sorted((a, b) -> a.compare(b))`, and so for `sort`.

### Iterable arguments

- Give `Map()` and `Set()` an Iterable itself: `Set(m.keys())`, not `Set(m.keys().to_array())`.

### Membership tests

- Write `x in xs`, not `xs.contains(x)`, where neither runs code, as `x in xs` evaluates `x` first.

### Membership lists

- Write `x in [A, B]`, not `x == A or x == B`, and `x not in [A, B]`, not `x != A and x != B`, where `x` runs no code and the items are literals, members of enums or constants, of an integer, a `Char`, a `Bool`, an enum or a `String`.

### Range tests

- Write `x in a..=b`, not `x >= a and x <= b`, and `x in a..b`, not `x >= a and x < b`, where `x` and `b` run no code.
- Write `x not in a..=b`, not `x < a or x > b`, and `x not in a..b`, not `x < a or x >= b`, likewise.

### Negated is tests

- Write `x is not T`, not `not (x is T)`.

### Union is tests

- Write `x is A | B`, not `x is A or x is B`, and `x is not A | B`, not `x is not A and x is not B`, where `x` runs no code.

### Negated in tests

- Write `x not in xs`, not `not (x in xs)`.

### Negated conditions

- Write `unless x` and `until x`, not `if not x` and `while not x`.
- But keep `if not` where the `if` has an `else` or follows one: `else if not x`.
- Give `not` to each operand of an `and` or an `or`: `if not a or not b`, not `unless a and b` or `if not (a and b)`, and `while not a and not b`, not `until a or b`.
  - A `not` given to an operand writes `a != b` for `a == b`, `x not in xs` and `x is not T`, takes out a double negation, and goes on into an `and` or an `or` inside: `if not (b or x == 5)` is `if not b and x != 5`.
  - Why: `unless a and b` and `if not (a and b)` are easily misread as `not a and not b`, while `not` on each operand states each test as it is.
- Do not negate a negation:

| Write | Not |
|---|---|
| `if x` | `if not not x` |
| `if a == b` | `unless a != b`, `if not (a != b)` |
| `if x != nil` | `unless x == nil` |
| `if x in xs` | `unless x not in xs` |
| `if x is T` | `unless x is not T` |

- So in a value: `flag`, not `not not flag`.

## Statements

### Implicit return

- End a function with its value (`x`), not `return x`, except a multi-line literal (see [Multi-line literals](#multi-line-literals)).
- Do not end a function returning nothing with a bare `return`.

### Semicolons

- Put each statement on a line of its own. `;` is for a program given on the command line (see [`-e`](compiler.md#run)).

### Postfix forms

- Use the postfix form (`return nil unless found`) if the body is one statement other than a declaration, without a postfix form of its own, of:
  - a `while` or a `for`;
  - an `if` without `else` whose value is not used and which is not the whole body of an `else`.
- If it exceeds 100 columns or takes more than one line, use the block form even for one statement.
- Do not stack postfix forms (`x += 1 for x in xs while ok`).
- A `for` whose body is one statement with a postfix `if` is written as a block holding it (`for x in xs`, then `total += x if x > 0`), not as `total += x for x in xs when x > 0`, which the formatter cannot tell from it.

### Branches

- Branch two ways with `if`/`else`, including for a value and on a subject (`if x is T`, `if kind == 'a'`), and three or more ways with `case`.
- A two-way `case` without `else` that handles every type or member of its subject (see [case with a subject](control-flow.md#case-with-a-subject)) stays a `case`.
  - Why: a type or member added later then fails to compile, where an `if` would take it to `else`.
- A two-way value that fits on one line is `c then a else b`.
- An arm whose body is one statement that its line can hold (see [case without a subject](control-flow.md#case-without-a-subject)) and that fits on it, all of it, is written on it, `when 1 then 'one'` or `else pass`, and otherwise as a block, as is one of a `'''` literal.
- An `else` whose body is one `if` is `else if`, unless a comment comes before the `if`.
- An `if`, a `case` or a `try` whose blocks are on the lines below starts a line of its own, one level deeper than the line that takes its value (`x :=`, then `case n` on the next line), where the grammar allows it (see [bracketless blocks](syntax.md#bracketless-blocks)).

### Shared arm bodies

- Write arms next to each other whose bodies are the same as one arm of their patterns, `when Point, Circle then shape.name`, not an arm for each.

## Declarations

### Modules

- A library module contains only code that builds the exported values. Put code to run in a separate entry file.

### Top-level order

- Declare a top-level value above the code that uses it, wherever the order allows.

### Structs

- Declare a type `struct` unless it needs what only a class has: `var` or weak fields, `deinit`, or comparison by identity (see [mutability](objects.md#mutability)).

### Fields

- A value that is fixed at construction and takes no arguments is a field (`port := @listener.port`), not a method.

### Type bodies

- Write the constructor arguments of a type alone first, then those with a value.
- Declare a class's field `var` only if it is assigned.

### Private blocks

- Put two or more private members in a row in one `private` block, comments and blank lines between them or not; mark one alone `private` on its line.

```lerta
class Counter
  args
    label: String
  private
    var count = 0
    step := -> @count += 1
  show := -> print "#{@label}: #{@count}"
  private reset := -> @count = 0
```

### Integer types

- Quantities (counters, sizes, indexes, `length`) are `Int`, which every API takes.
- Unsigned types are for bit operations, FFI and `Byte`.

### Nil initial values

- Write `var found: String?`, not `var found: String? = nil`.
- Write a field `parent: Node?`, not `parent: Node? = nil`, where it is nil either way: a constructor argument, of a struct or in `args`, which may be left out, or a class's `var`.

### Empty initial values

- Write `names: String[]`, not `names: String[] = []`.
- Write `seen: Set<String>`, not `seen := Set<String>()` or `seen: Set<String> = Set()`; the same for `Map`.
- So does a `var`: `var names: String[]`; but a field keeps its value, as one without is a constructor argument.

### Type annotations

- Omit a type that can be inferred:
  - the return type of a function;
  - the type of a parameter of a function literal whose type is expected (`xs.map((x) -> x * 2)`) or that has a default;
  - the type of a variable or of a field with a value.
- The type of a variable or a field whose value is `Map(...)` or `Set(...)` goes to its type arguments: `var seen = Set<String>()`, `names := Set<String>(['a'])`; but a `const` variable's empty one goes as a whole (see [Empty initial values](#empty-initial-values)).
- Write it:
  - where the language requires it (recursion, `nil` alone, an empty array);
  - where it changes the type (`var x: Int? = 1`);
  - in generic functions, classes, structs and extends, whose instances are checked apart.

### Function bodies

- A body of one statement that fits on the line of the `->`, all of it, goes on it (`(x) -> x + 1`). One that would take lines below, as a call with a function last whose body is a block or a `'''` literal, does not.
- Otherwise it goes in a block below it, as does one statement that a line cannot hold: a declaration, or one that holds a block, as a `case`, a `try` or a loop without a postfix form.

### Functions without parameters

- Write `-> body`, not `() -> body`, unless it has a return type or type parameters (`(): T -> body`, `<T>() -> body`).

### Function types returned

- Name a function type that a function literal returns with a `type` alias, `type Combine = (Int, Int) -> Int`, rather than writing it in parentheses before the `->` of the body, where the arrows run together.
