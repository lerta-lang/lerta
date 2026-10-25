# Errors

## Exceptions

```
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

- `throw value` throws an exception: a value of a type that satisfies `interface Error` of `std:builtins`, whose one member is `message: String`, converted to an `Error` as a value converts to an [interface type](objects.md#interfaces), so a class or struct, which a program declares for its own errors, as `struct NotFound: Error` (see [declaring an interface](objects.md#interfaces)). It is an expression of type `never`, so it can stand wherever a value is expected (`case` arms, `x ? throw NotFound(message: 'missing')`); `never` does not count when the types of arms or returns are combined, and a function may end with it.
- The runtime's errors are exceptions too, of types that `std:builtins` exports, each a struct of one field, `message`:

  | Type | Thrown by |
  |---|---|
  | `IndexError` | an index or a slice out of range, `pop` of an empty array |
  | `ArithmeticError` | integer overflow, division by zero, a float that would be NaN (`not a number`) |
  | `NilError` | `x!` of nil |
  | `CastError` | `x as T!` of a value of another type |
  | `IterError` | a second traversal of an `Iter`, `next` past its end, reading an `Iter` from within its own function |
  | `WeakError` | a `weak!` field whose object is gone |
  | `IOError` | a file that cannot be read or written, a command that cannot be run |
  | `ValueError` | an argument of a value that a function does not take, as `split('')`, `exit(256)`, `sleep(-1)`, `zip` of Iterables of different lengths, and `c + n` or `c - n` of a `Char` past the Unicode scalar values |
  | `InitError` | a top-level value used before it is initialized (see [top-level values](functions.md#top-level-values)) |
  | `CancelledError` | the `await` of a promise that is cancelled (see [functions that await](functions.md#functions-that-await)) |
- A `String` cannot be thrown: `throw` takes an `Error`, so that a `catch` can tell errors apart by type.
- `try` runs its block. An exception thrown there, in it or in a function it calls, goes to its `catch` clauses, tried in order: `catch e: T` takes an exception whose type is `T`, or a member of the union `T`, as `is` tells, and its block sees it as `e`, of that type; `catch e` takes any, `e` being an `Error`. A type that a catch names must be a class or struct, or a union of them, that satisfies `Error`. An exception that no catch takes goes on, as from where the `try` is.
- `finally` and its block, after the catches, run after the try block or the catch that ran, and before an exception goes on, the one that no catch takes or that a catch throws. A `try` has at least one `catch` or a `finally`. `return`, `break` and `continue` that leave a `try` run its `finally` on the way, and those of the `try`s around it that they leave, innermost first; the value of `return` is held meanwhile, and an exception that a `finally` throws goes on from there instead, as from where the `try` is. They cannot leave a `finally` block itself, since they would drop an exception on its way.
- `try` is an expression: its value is that of its block, or of the catch that ran, whose types make its type as those of the arms of a `case` do (see [control flow](control-flow.md)); if one of them gives none, it gives none. The value of `finally` is discarded.
- On its way, an exception releases what it leaves: the values of the expressions it interrupts, the locals of the blocks and the functions it leaves, and the fields of an object it interrupts the construction of, whose `deinit` does not run.
- An uncaught exception prints its message and a newline to stderr, after flushing stdout, then its trace, and the program exits with status 1. The trace tells where the exception was thrown and the calls and the `await`s it went through, innermost first, one line each, as `  at <function> (<file>:<line>:<column>)`:
  - The function is named as it is declared, a method as `<type>.<name>` (as `Box<Int>.get`), a constructor by its type, a function literal as `<function>.<anonymous>` after the function it is in, and the top-level code of a module as `<top level>`. The file is as compile errors name it, relative to the current directory when the program was built, or `std:<name>`; the line and the column are those of the statement or the expression that threw or made the call.
  - A `throw` of the exception that a `catch` has taken, by the catch's name, goes on with its trace, unless another was thrown meanwhile: the trace then tells both where it was first thrown and where it was thrown again. Any other `throw` starts a new trace, even of an object thrown before.
  - The trace keeps the 32 entries nearest to the throw and the 32 outermost; between them, `  ... <n> more` tells how many it leaves out.
  - A program built with `--no-trace` prints the message alone (see [the compiler](compiler.md#build)).
- Why exceptions propagate as a pending exception checked after each call, rather than by unwinding the machine stack, is in [internals](../internals.md#exceptions).

## Panics

A panic prints its message and a newline to stderr, after flushing stdout, and aborts the program; it cannot be caught. `panic(message)`, of `std:builtins`, panics: for a bug that no caller could handle, such as a broken invariant, where an exception could be caught by mistake. Running out of memory panics with `out of memory`, and recursing too deep with `stack overflow`. The runtime also panics when its internal invariants are violated or a system call it cannot do without fails, such as `deinit kept a reference to its object` or `cannot wait for a child process`. A panic for an exception that nothing could take, `deinit threw an exception: <message>` or `init threw an exception after its object escaped: <message>` (see [objects](objects.md)), prints the exception's trace after it, as an uncaught exception does.

## Discarded values

These apply when a value in statement position is not captured.

- A literal, a name, an operator expression, a field or an index (`'a'`, `x`, `1 + 2`, `x == 1`, `p.x`, `xs[0]`) → error. An unused comparison often means a mistyped assignment.
- A function value itself (`f` after `f := () -> 1`) → error "function value is unused; to call it, write `f()`".
- An [`Iter`](types.md#iter) (`xs.map(f)`) → error "an Iter does nothing until it is consumed".
- A [`Promise`](functions.md#functions-that-await) (`fetch('a')`) → error "a Promise must be awaited". An Iter or a Promise that an arm of an `if`, a `case` or a `try` gives is reported so too, where the statement gives no value as its arms' values have no type in common, as in the last statement of a function that gives none.
- A call, an `await`, or an expression with no value such as a `case` whose arms are calls to `void` functions → allowed.
- A `try` → its blocks are checked as statements, as the branches of an `if` are, so the last statement of its block and of each catch is checked by these rules.

## Unused names

A `const` or `var` that is never read (assigning to it does not count) produces a warning, `'x' is never used`, unless its name starts with `_`. A top-level one may be read by any function, so it is warned about only when the whole module compiles. An exported one is not warned about, since another module may read it. An imported name that the module never uses produces a warning too, `'sleep' is imported but never used`. A [C function](functions.md#c-functions) that a module declares is never warned about.

## Unreachable code

A statement after one that never ends produces a warning, `unreachable code`: after `return`, `break`, `continue` or `throw`, another expression typed `never`, such as a call of `exit` or a `case` whose arms all end so, or an `if` or a `try` that ends with one in each way out. The warning is at the first statement after it; a statement after that one is warned about again only if it follows another that never ends.

## Cycles

A function literal that captures `@`, stored where `@` holds it, produces a warning, since the object and the literal then hold each other and neither is ever freed ([objects](objects.md#classes-and-structs)). The warning suggests a [weak function literal](functions.md#function-literals), `weak -> ...`, which captures `@` weakly.

- The literal captures `@` itself, or a `const` that holds `@`, as `me := @`, not a weak one; a `var` that holds `@` may change, and is not seen.
- The place is a field reached from `@`, as `@on_press` or `@child.f`, or an item of an array or a map so reached, set by assignment or by `push`, through `!` too; not through a weak field, which holds its object without keeping it.
- The literal is the value stored, or a value that `?` or `then`/`else` gives, or an item, a field or a constructor argument of it.
- Only a literal written in place is seen: one held by a local first, as `g := -> @n` before `@f = g`, or given to a method, is not, and neither is a capture of a const of such a const.
