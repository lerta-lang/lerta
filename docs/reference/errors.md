# Errors

## Exceptions

```lerta
struct NotFound: Error

find := (key: String) ->
  throw NotFound(message: "no #{key}") if key != 'a'
  1

n :=
  try
    find 'b'
  catch e: NotFound
    print e.message
    0
  finally
    print 'done'
```

### throw

- `throw value` throws an exception: a value of a type that satisfies `interface Error` of `std:builtins`, whose one member is `message: String`.
- The value is converted to an `Error` as a value converts to an [interface type](objects.md#interfaces). It is a class or struct, which a program declares for its own errors, as `struct NotFound: Error`.
- `throw` is an expression of type `never`, so it can stand wherever a value is expected: `case` arms, `x else throw NotFound(message: 'missing')`. `never` does not count when the types of arms or returns are combined, and a function may end with it.
- A `String` cannot be thrown: `throw` takes an `Error`, so that a `catch` can tell errors apart by type.

### Runtime errors

The runtime's errors are exceptions too, of types that `std:builtins` exports, each a struct of one field, `message`:

| Type | Thrown by |
|---|---|
| `IndexError` | a place in a sequence out of range: an index, the ends of a slice, the place a search starts from; `pop` of an empty array |
| `ArithmeticError` | integer overflow, division by zero, a float that would be NaN (`not a number`) |
| `NilError` | `x!` of nil |
| `CastError` | `x as T!` of a value of another type |
| `IterError` | a second traversal of an `Iter`, `next` past its end, reading an `Iter` from within its own function |
| `WeakError` | a `weak` field of type `T!` whose object is gone |
| `IOError` | a file that cannot be read or written, a command that cannot be run |
| `ValueError` | an argument of a value that a function does not take, as `split('')`, `exit(256)`, `sleep(-1)`; a negative count, length or limit (`repeat(-1)`, `truncate(-1)`; 0 is taken); `zip` of Iterables of different lengths; `c + n` or `c - n` of a `Char` past the Unicode scalar values |
| `InitError` | a top-level value used before it is initialized (see [top-level values](functions.md#top-level-values)) |
| `CancelledError` | the `await` of a promise that is cancelled (see [functions that await](functions.md#functions-that-await)) |
| `AssertionError` | a failed [`assert`](#assert) |

### assert

```lerta
assert scores['ann'] == 3
assert value is String
print value.to_upper()
```

- `assert condition` throws an `AssertionError` unless the condition holds: a `Bool`, or an optional value, which holds when it is not nil, as the condition of an `if`.
- What follows is narrowed where the condition holds, as after a guard (see [narrowing](control-flow.md#narrowing)): above, `value` is a `String` after the second assert.
- The message tells where the call is and quotes it, as `scores.lerta:4:1: assert scores['ann'] == 3`: its line, through the line that closes the brackets it opens, without a comment after it.
- Of a comparison (`==`, `!=`, `<`, `<=`, `>`, `>=`, `in`) or `x is T`, the message gives a line for each operand that is not written as a literal, `  left: 2`, `  right: ...` or `  value: ...`, with its [literal](builtins.md#literal):
  - none for a value whose type has no `to_literal`, as an object of a class, or an array, map or set of them.
- Each operand is evaluated once, before the comparison: the message gives the value that was compared. An operand that takes its type from the other, as `1` in `small == 1` of an `Int8`, is typed as it is in the comparison.
- `assert` can only be called, not used as a value. A name of the program's own hides it, as it hides any builtin.

### try and catch

- `try` runs its block. An exception thrown there, in it or in a function it calls, goes to its `catch` clauses, tried in order:
  - `catch e: T` takes an exception whose type is `T`, or a member of the union `T`, as `is` tells. Its block sees it as `e`, of that type.
  - `catch e` takes any; `e` is an `Error`.
- A type that a catch names must be a class or struct, or a union of them, that satisfies `Error`.
- An exception that no catch takes goes on, as from where the `try` is.
- A `try` has at least one `catch` or a `finally`.
- `try` is an expression: its value is that of its block, or of the catch that ran. Their types combine as those of the arms of a [`case`](control-flow.md#the-type-of-a-case) do; if one of them gives none, the `try` gives none.

### finally

- `finally` and its block, after the catches, run after the try block or the catch that ran.
- It also runs before an exception goes on: the one that no catch takes, or one that a catch throws.
- The value of `finally` is discarded.
- `return`, `break` and `continue` that leave a `try` run its `finally` on the way, and those of the `try`s around it that they leave, innermost first.
  - The value of `return` is held meanwhile.
  - An exception that a `finally` throws goes on from there instead, as from where the `try` is.
- They cannot leave a `finally` block itself, since they would drop an exception on its way.

### Release on the way

An exception releases what it leaves:

- the values of the expressions it interrupts;
- the locals of the blocks and the functions it leaves;
- the fields of an object it interrupts the construction of, whose `deinit` does not run.

### Uncaught exceptions

An uncaught exception prints its message and a newline to stderr, after flushing stdout, then its trace, and the program exits with status 1.

The trace tells where the exception was thrown and the calls and the `await`s it went through, innermost first, one line each:

```
  at <function> (<file>:<line>:<column>)
```

| Part | Written as |
|---|---|
| function | as it is declared |
| method | `<type>.<name>`, as `Box<Int>.get` |
| constructor | its type |
| function literal | `<function>.<anonymous>`, after the function it is in |
| top-level code of a module | `<top level>` |
| file | as compile errors name it: relative to the current directory when the program was built, or `std:<name>` |
| line and column | those of the statement or the expression that threw or made the call |

- A `throw` of the exception that a `catch` has taken, by the catch's name, goes on with its trace, unless another was thrown meanwhile. The trace then tells both where it was first thrown and where it was thrown again.
- Any other `throw` starts a new trace, even of an object thrown before.
- The trace keeps the 32 entries nearest to the throw and the 32 outermost. Between them, `  ... <n> more` tells how many it leaves out.
- A program built with `--no-trace` prints the message alone (see [the compiler](compiler.md#build)).
- Why exceptions propagate as a pending exception checked after each call, rather than by unwinding the machine stack: see [internals](../internals/execution.md#exceptions).

## Nil or an exception

A failure that the caller is to handle gives nil, of an optional type, rather than throwing, since the compiler sees a nil that goes unhandled and not an exception. A caller that knows it does not fail says so with `!`. So nil is given by lookups (`xs.get(i)`, `m[k]`, `find`), conversions and parsing (`to_int`, `parse_int`, `b.text()`), and questions about what is there (`stat`, `env`).

A function throws instead where nil would not do:

- **A bug of the caller**, as an index out of range or a negative count: a caller that knows its index is in range would only write `!`, which throws too. A form that gives nil is there where the question is one about input: `xs.get(i)` for `xs[i]`, `as T?` for `as T!`.
- **No value to hold nil**, as `make_dir` or `write_file`: a call's result may be discarded, so a nil that one gave would go unseen.
- **A nil that means something else already**: the end of a `read_line`, an unset `env`. So a line or a value that is not valid UTF-8 throws there, and so do `argv` and `list_dir`, whose arrays would otherwise be of optional items.
- **A reason to tell**, as which file could not be opened, or where `decode_json` found what is not JSON.

## Panics

- A panic prints its message and a newline to stderr, after flushing stdout, and aborts the program. It cannot be caught.
- It ends the program as C's `abort` does: by SIGABRT on POSIX systems, which shells report as status 134, and with exit code 3 on Windows.
- `panic(message)`, of `std:builtins`, panics. It is for a bug that no caller could handle, such as a broken invariant, where an exception could be caught by mistake.

The runtime panics:

| Message | When |
|---|---|
| `out of memory` | memory runs out |
| `stack overflow` | recursion is too deep |
| `deinit kept a reference to its object` | a `deinit` keeps its object (see [deinit](objects.md#deinit)) |
| (various) | an internal invariant is violated, or a system call it cannot do without fails, as `cannot start the thread that reads stdin` |
| `deinit threw an exception: <message>` | `deinit` throws (see [deinit](objects.md#deinit)) |
| `init threw an exception after its object escaped: <message>` | `init` throws after its object escaped (see [a construction that throws](objects.md#a-construction-that-throws)) |

The last two print the exception's trace after the message, as an uncaught exception does.

## Discarded values

These apply when a value in statement position is not captured.

| Statement | Result |
|---|---|
| a literal, a name, an operator expression, a field or an index (`'a'`, `x`, `1 + 2`, `x == 1`, `p.x`, `xs[0]`) | error. An unused comparison often means a mistyped assignment. |
| a function value itself (`f` after `f := () -> 1`) | error, `` function value is unused; to call it, write `f()` `` |
| an [`Iter`](types.md#iter) (`xs.map(f)`) | error, `an Iter does nothing until it is consumed` |
| a [`Promise`](functions.md#functions-that-await) (`fetch('a')`) | error, `a Promise must be awaited`. When the call names a top-level function, of the module or imported but not from std, whose own body awaits, the message adds where it first awaits. Give one whose work goes on unawaited to `spawn` of [std:async](std.md#stdasync). |
| a call, an `await`, or an expression with no value | allowed |
| a `try` or a `case` | its blocks are checked as statements, as the branches of an `if` are: the last statement of each block, catch or arm is checked by these rules, and their values need no type in common |

An Iter or a Promise that a branch of an `if` gives is reported too where the `if` gives no value, as its branches' values have no type in common, as in the last statement of a function that gives none.

## Unused names

| Name | Warning |
|---|---|
| a `const` or `var` that is never read (assigning to it does not count) | `'x' is never used` |
| an imported name that the module never uses | `'sleep' is imported but never used` |

- A name that starts with `_` is not warned about.
- A top-level `const` or `var` may be read by any function, so it is warned about only when the whole module compiles.
- An exported one is not warned about, since another module may read it.
- A [C function](functions.md#c-functions) that a module declares is never warned about.

## Unreachable code

- A statement after one that never ends produces a warning, `unreachable code`.
- A statement never ends if it is:
  - `return`, `break`, `continue` or `throw`;
  - another expression typed `never`, such as a call of `exit` or a `case` whose arms all end so;
  - an `if` whose branches all end so;
  - a `try` whose block and catches all end so, or whose `finally` ends with a `throw`.
- The warning is at the first statement after it. A statement after that one is warned about again only if it follows another that never ends.

## Stale fields

A computed field of a class whose initializer reads a `var` field produces a warning, `'double' is computed once, from the value 'count' has then`, suggesting a method (see [construction](objects.md#construction)).

## Cycles

A function literal that captures `@`, stored where `@` holds it, produces a warning: the object and the literal then hold each other, and neither is ever freed (see [weak references](objects.md#weak-references)). The warning suggests a [weak function literal](functions.md#weak-function-literals), `weak -> ...`, which captures `@` weakly.

So does one that captures a local's object, stored where that object holds it, as `job.on_done = -> print job.name`; that warning suggests capturing a weak local of it instead (see [weak references](objects.md#weak-references)), or, as a weak local holds only an object of a class, taking the literal out of it by hand once done with it.

What is seen:

- **The capture.** The literal captures `@` itself, or a `const` that holds `@`, as `me := @`, or a local's object: that of a `const`, a parameter or a loop variable, not a weak one. A `var` may change, and is not seen. A top-level value is not captured, so a literal that reads it holds nothing.
- **The place.** A field reached from `@` or from that local, as `@on_press`, `@child.f` or `job.on_done`, or an item of an array or a map so reached, through `!` too. Not one reached through a weak field, which holds its object without keeping it.
- **The storing.** An assignment, a `push`, or a call of a method of the object that the place is, which keeps its argument: one that stores it where its own object holds it, as these rules tell, or passes it on to such a method of an object it holds, in any order of declaration. `@bus.subscribe(-> @count += 1)` is warned about if `subscribe` keeps its argument.
  - Only the methods of a class or struct that is not generic, themselves not generic, are followed; not those of an extend or an interface value.
- **The value.** The literal is the value stored, or a value that `?` or `then`/`else` gives, or an item, a field or a constructor argument of it. A method keeps its parameter only if it stores or passes on the parameter itself.
- Only a literal written in place is seen. One held by a local first, as `g := -> @n` before `@f = g`, is not, and neither is a capture of a const of such a const, nor a place reached from a local that holds what `@` holds, as `plus := @widget.add(Widget())` before `plus.events.on(-> @count += 1)`.
