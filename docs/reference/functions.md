# Functions

## Declaring functions

```
gcd := (a: Int, b: Int): Int ->
  return a if b == 0
  gcd b, a % b

square := (x: Int) -> x * x
greet := -> print('hello')
```

- A function is declared as a top-level `const` whose value is a [function literal](#function-literals): `(<parameters>): <return type> -> <body>`.
- A function literal held by a local `const` is a [function value](#function-values) instead. Unlike a top-level function, it cannot be used before its declaration, call itself or be generic.
- Parameters are `name: Type`. With no parameters, `()` may be omitted.

### A declared function type

A top-level function's declaration may write its type, a function type, as any `const` may: `greet: Handler = (name) -> "hello, #{name}"`.

- The function then has that type, and its literal is checked against it, as a local's literal is checked against the type expected:
  - the literal may leave out the types of its parameters;
  - its results need only fit the return type, which may be wider, as `Int?`;
  - a `Promise` there is settled (see [functions that await](#functions-that-await)).
- The types that the literal writes must agree with the declared one.
- The literal cannot be generic, variadic or have defaults, which a function type cannot tell.

### Defaults

A parameter of a top-level function or a method may have a default, `name: Type = value`, which a call may leave out: `greet('a')` calls `greet = (name: String, greeting = 'hello') -> ...` with `'hello'`.

- The parameters after one with a default must have defaults too. A call leaves out some of them from the last.
- The type may be left out when the default is an `Int`, `Float`, `String` or `Bool` literal.
- A default is computed at each call that leaves it out, in order, before the body runs.
- It sees the names of the function's module, `@` in a method and the parameters before it. It cannot `return`, `break` or `continue`.
- A default of a generic function or method is checked for an instance only where a call leaves it out, so that it need fit only the type arguments of such calls. With `total = <T: Add<T, T>>(xs: T[], zero: T = 0)`:
  - `total([1, 2])` takes 0 as an `Int`;
  - `total(['a'], '')` gives its own zero;
  - `total(['a'])` is an error at the call, `expected String, got Int (in the defaults of total<String>)`.
- A default belongs to the declaration, not to the function's type: a function used as a value takes every argument.
- A function literal elsewhere cannot have defaults so far.
- For a class's or struct's constructor arguments, see [`default`](objects.md#members).

### Variadic parameters

The last parameter of a top-level function or a method may be variadic, `rest: Type...`, or the one before a [last struct parameter](#a-last-struct-parameter). It takes the arguments after the others, none or more, as a `Type[]`: `sum(1, 2, 3)` calls `sum = (first: Int, rest: Int...) -> ...` with `[2, 3]` as `rest`.

- Among those arguments, a spread `xs...` gives the items of `xs`, anything a `for` goes through, as in an [array literal](types.md#array), which they make.
- The array is new, so the function changing it changes nothing of the caller's.
- Its type must be written.
- A variadic function has no defaults.
- A spread is an argument only of a variadic parameter.
- Being variadic belongs to the declaration, as a default does: a variadic function used as a value takes the array, `(Int, Int[]) -> Int`.
- A function literal elsewhere cannot be variadic so far.

### A last struct parameter

When the last parameter is of a struct type, a call may give it as named arguments, which construct the struct as a call of its name does, or leave it out, which constructs it from none. With a struct `Options` whose members are `cwd: String? = default nil` and `count := default 1`, and `run = (command: String, args: String..., options: Options)`:

| Call | Is |
|---|---|
| `run('ls', '-l', cwd: dir)` | `run('ls', ['-l'], Options(cwd: dir))` |
| `run('ls')` | `run('ls', [], Options())`, an error if the struct has a field that must be given |

- A parameter of an optional struct type takes named arguments too, but is not left out so, as nil may be meant.
- After a variadic parameter, it is given only so, as the variadic parameter takes every argument without a name. Otherwise a value of the struct may still be passed.
- The struct need not be imported where the call is.
- Such a parameter has no default, as leaving it out already constructs it.
- Nor do the other parameters of its function have defaults so far, as the call would have to construct it after the defaults.
- Its type is a struct as written, not through a type parameter, so that every instance of a generic function agrees.
- A class is not constructed so, as a call would make one that the caller may not expect to share.
- A call of a generic function or method takes no named arguments, nor leaves out such a parameter, so far: `a generic function takes no named arguments so far`.
- For an anonymous struct, see [anonymous structs](types.md#anonymous-structs).

### The body and the result

- The body follows `->` on the same line, as a statement with its postfix forms (see [control flow](control-flow.md#if-and-while)), or as an indented block.
- Its last statement, if an expression, is the return value. `return <value>` returns early, and `return` alone returns without a value.
- In a function whose return type is `void`, written or given by a `return` alone before its last statement, the last statement's value is discarded, as that of any statement is (see [discarded values](errors.md#discarded-values)).
- The return type may be omitted. It is then the type of the returned values, which must all agree, or `void` if there are none:
  - a mix of `T`, `T?` and `nil` gives `T?`;
  - a mix of a union and some of its members gives the union;
  - `nil` alone does not give a type, so the return type must then be written.
- A recursive function must write its return type.
- A function whose return type is not `void` must end with its return value or a `return`. This is decided by the last statement alone: a body ending in `while true`, or in an `if` whose branches all return, still needs a final value.

## Top-level values

- Top-level functions can be used anywhere in the module, before their declaration too, so they can call each other recursively.
- A top-level function's body sees its parameters, its own locals, the top-level functions, `const`s and `var`s of its module, and builtins. It does not see the locals of blocks at the top level, such as those of an `if`.

### Use before initialization

- A top-level value read or assigned by a function or a method before the top-level code has initialized it throws an `InitError`, `'<name>' is used before it is initialized`.
- So does an imported value of a module of the same import cycle (see [modules](modules.md#top-level-code-and-cycles)).
- Its type must be known where it is used:
  - top-level code above its declaration cannot read it;
  - top-level code that calls a function whose return type is inferred, or constructs an object whose field type is inferred from an initializer, where that function or initializer uses the value, is an error. Move the declaration up, or write the type of the function or field.
- A `const` whose value is one of these is initialized from the start and never released, so that reading it never throws:
  - a literal of its own type, a `Bool`, a number or a `String`, as `LIMIT := 3`;
  - a [constant expression](types.md#constant-expressions) of its own type, as `SIZE := 64 * 1024`.

## Function values

```
double := (x: Int) -> x * 2
square := (x: Int) -> x * x
apply := (f: (Int) -> Int, x: Int) -> f(x)
print apply(double, 4)
steps := [double, square]
```

### Function types

- A function is a value of the function type `(<parameter types>) -> <return type>`, such as `(Int, String) -> Bool` or `() -> void`.
- To make it optional, put it in parentheses: `((Int) -> Int)?`.
- As a function literal's return type, the `->` after it starts the body, so a function type there is written in parentheses: `(n: Int): ((Int) -> Int) -> (x) -> x + n`. Two or more types in parentheses are a [tuple](types.md#tuples): `(x: Int): (Int, Int) -> (x, x)`.

### Functions as values

- The name of a top-level function, without a call, is its value. It can be stored, passed, returned and kept in arrays, maps and fields like any value, but not compared or printed.
- Where a function type is expected, these are function values too: a method of an object (`other.contains`), a method named by its type (`Char.is_digit`), a [C function](#c-functions) and a generic function.
  - Each is the function literal that calls it, which takes its parameter types from the expected type, as a generic function's type arguments do too: `files.all(is_file)` and `s.all(Char.is_digit)` are `files.all((file) -> is_file(file))` and `s.all((c) -> c.is_digit())`.
  - A method named by its type takes the receiver as its first argument. The type is a class, a struct or a builtin type of no type arguments, so far, not an enum, an interface, an alias or a generic type.
  - A method of an object captures the object, which is `@` or a name that cannot be assigned, so far. One of `@` stored where `@` holds it makes a cycle, as a literal that captures `@` does (see [cycles](errors.md#cycles)).
- Elsewhere, as for a `const` without a type, generic functions, C functions and methods can only be called, and builtins (`print`) everywhere, so far.
- Calling a value of a function type calls the function it holds: `f(x)`, `make()(x)`, and `button.on_press(x)` for a field that holds a function.

### Fitting a function type

- A function value fits only where its type is expected exactly: `(Int) -> Int` does not fit where `(Int) -> Int?` is expected.
- The one exception is a function that returns a `Promise` of its result (see [functions that await](#functions-that-await)). A `(Request) -> Response` where a `(Request) -> Promise<Response>` is expected, or a `() -> void` where a `() -> Promise` is, or such a function optional, becomes a function that calls it and returns a `Promise` settled with its result, or rejected with what it throws.

## Function literals

```
make_adder := (n: Int): ((Int) -> Int) -> (x) -> x + n
print [1, 2, 3].map((x) -> x * x).to_array().length
```

- A function literal can be written wherever a value is expected. Each evaluation gives a function with the values captured then.
- Where a function type is expected (a parameter, an annotation, a return type), the literal's parameter types and return type may be left out and are taken from it: `(x) -> x * 2`. Otherwise the parameters' types must be written.
- A literal that writes its return type writes its parameters' types too: `(x): T -> x` does not parse.
- `return` in a function literal returns from the literal; `break` and `continue` cannot leave a loop around it.

### Captures

- A function literal sees the locals around it.
- It captures the value of a `const`, a parameter, a loop variable or, in a method, `@`, narrowed as it is there, when it is evaluated: `n` above keeps the value it had when `make_adder` was called.
- It shares a `var` with the function that declares it, and with the other literals that capture it: each can read and assign it, and sees the others' assignments, even after that function has returned.
- The language does not prevent cycles through closures (`@button.listen -> @count += 1`), and there are no capture lists. The typical one gets a [warning](errors.md#cycles).

### Weak function literals

`weak -> body`, written in a method of a class, captures `@` without keeping it alive, so that `@` may hold it: `@on_press = weak -> @count += 1`.

- A call while the object lives runs the body with `@` as usual, holding the object until the body ends, across `await` too.
- A call once the object is gone runs none of it. So the literal gives no value: its result is `void`, or a `Promise` of none if it awaits.
- It must use `@`, which it is for.
- A literal inside it captures `@` from it as any literal does.
- `weak` is not a [keyword](syntax.md#contextual-words).
- To capture another object weakly, use a [weak local](objects.md#weak-references).

## Functions that yield

```
countdown := (n: Int) ->
  var i = n
  while i > 0
    yield i
    i -= 1

print x for x in countdown(3)
```

- A function whose body has a `yield <value>` of its own, outside the function literals in it, returns an [`Iter`](types.md#iter) of the values it yields.
  - Why no keyword marks such a function, as `function*` does in JS: the `yield` and the return type already tell (the CoffeeScript approach).
- Calling it runs none of the body. Asking the `Iter` for an item runs the body from where it stopped to its next `yield`, which gives the item, or to its end, which ends the `Iter`.
- Its return type is an `Iter`, as in `(): Iter<Int> ->`, whose item type the yielded values must fit. Left out, it is an `Iter` of the yielded values' type, worked out as a return type is from returned values; `nil` alone does not give one.
- `return` alone ends the `Iter`. A `return` with a value is an error, and the last statement gives no value.
- `yield` is a statement, written only where `return` may be (see [control flow](control-flow.md#if-and-while)), and not in a `try` that has a `finally` so far.
- `init` and `deinit` cannot yield.
- The body holds its parameters, `@` and what it captures until the `Iter` ends or is dropped. An `Iter` dropped before its end releases what the body holds where it stopped, without running the rest of the body.
- An exception thrown in the body goes to the code that asked for the item, and ends the `Iter`.
- Asking the `Iter` for an item from within its own body throws `an Iter cannot be read while its function runs`.

## Functions that await

```
import sleep from 'std:time'

fetch := (name: String) ->
  await sleep(1)
  "#{name} fetched"

main := ->
  a := fetch('a')
  b := fetch('b')
  print "#{await a}, #{await b}"

await main()
```

- A function, or a function literal, whose body has an `await <promise>` of its own, outside the function literals in it, returns a `Promise` of its result.
  - Why `await` alone marks such a function, with no `async`: as for [`yield`](#functions-that-yield).
- Calling it runs the body at once, up to an `await` of a promise that is not settled yet. The body then waits, and the call returns the `Promise`. So `a` and `b` above wait at the same time.
- Its return type is a `Promise`, as in `(): Promise<Int> ->`, whose type the returned values must fit. Left out, it is a `Promise` of the returned values' type, worked out as for any function.
- An exception that leaves the body settles the `Promise` with it.
- `await` is an expression, written anywhere in the body but in a default, or in the top-level code (below). It cannot be in a [lazy comprehension](control-flow.md#for-and-ranges), whose items are computed elsewhere.
- A function cannot both yield and await yet. `init` and `deinit` cannot await.
- A statement that only makes a `Promise` is an error (see [discarded values](errors.md#discarded-values)): an exception it would throw could be lost.

### Promises

- A `Promise<T>` is settled once: with a value of type `T`, or with an exception.
- `await` gives the value of a settled promise, or throws its exception, and can be applied to the same promise again. On one that is not settled, it waits for it first.
- `promise.is_settled()` tells whether it is settled, without waiting: a call that does not wait gives one that is.
- A function without a result returns a `Promise` with no type argument, which is settled without a value.
- A `Promise` dropped with an exception that no `await` has taken ends the program as an uncaught exception does.

### A Promise return type without await

A function that does not await, but whose return type is a `Promise`, written or expected (as that of a function literal passed where a `(Request) -> Promise<Response>` is expected), settles that `Promise` with its result as a function that awaits does, unless it returns `Promise`s.

- Its first result that does not end it, as a `throw` does, tells which. One with no other result settles it.
- `(): Promise<Int> -> 1` returns a `Promise` settled with 1, and rejected with what the body throws, which the call then does not throw.
- `(): Promise<Int> -> other()` returns the `Promise` that `other` gives.
- A function of a `Promise` with no value settles it unless its last statement gives a `Promise`.
- Until its first result tells, a result's type comes from the `Promise`'s value, as `[]` or the arms of `then` need. So a function that returns `Promise`s through `then` writes its type.

### The event loop

- The waiting bodies go on in the event loop, which runs once the program's top-level code has run, or has come to wait, until nothing is left to wait for. The top-level values are released after it.
- **Top-level code awaits too**, that of any module: a module's top-level code then waits as a function's body does, and the modules that import it run once it is done (see [modules](modules.md#top-level-code-and-cycles)).
- If the program's top-level code still waits when nothing is left to run, the program ends with the error `the top-level code awaits a promise that is never settled`.

### Cancellation

- `promise.cancel()` says that what a promise waits for is not wanted any more.
- It goes down the promises that the body awaits, through the bodies awaiting them, to the deepest body. There its `await` throws a `CancelledError`, `cancelled`, which unwinds it, through its `finally` blocks, and the bodies that await it, as any exception does, unless a `catch` takes it.
- The `sleep`, the read of a file or of stdin, or the `Deferred` that it waits for is cancelled too: its `Promise` is rejected with the `CancelledError`.

  | Work cancelled | What happens |
  |---|---|
  | a sleep | stops |
  | a read or a write of a file | goes on to its end, unseen |
  | the read of stdin under way | gives its chunk to the next read |
  | a program that `run` started | is stopped, its `Promise` rejected once it has ended (see [std:process](std.md#stdprocess)) |

- A body whose promise has been settled but which has not resumed yet throws on resuming, and that promise's value or error is dropped for it. An error so dropped does not end the program when the promise is released, though another `await` of the promise still takes it.
- A promise already settled is not changed.
- `all`, `race` and `timeout` cancel the promises they were given (see [std:async](std.md#stdasync)).
- A `Promise` that a cancel has gone through ends nothing when it is dropped rejected with a `CancelledError`, as nothing need take that of work that was given up. These still end the program as any uncaught error does:
  - another error that rejects it, as one that a `finally` block throws;
  - a `CancelledError` that a program throws in a `Promise` that no cancel has gone through.

## Generic functions

```
struct Point
  x: Int
  y: Int
  to_string := -> "(#{@x}, #{@y})"

first := <T>(xs: T[]): T -> xs[0]
show := <T: Stringable>(label: String, x: T) -> print("#{label}: #{x}")
empty := <T>(): T[] -> []

print first(['a', 'b'])
show 'point', Point(x: 1, y: 2)
xs := empty<String>()
```

- A top-level function may declare type parameters before its parameters: `<T, U>`. So may a method of a class, struct or extend (see [generic methods](objects.md#generic-methods)). A function literal elsewhere cannot so far.
- A type parameter cannot have the name of a type, builtin ones included, as `<Int>` would read as a function for `Int` alone.
- A generic function can be exported and imported.
- For named arguments in a call of it, see [a last struct parameter](#a-last-struct-parameter).

### Bounds

- `T: Shape` bounds a type parameter by an [interface](objects.md#interfaces): its type argument must satisfy it, with the extends in effect where the function is called. `Stringable` is a builtin one (see [Stringable](builtins.md#stringable)).
- A bound is checked at the call, so an argument that does not satisfy it is an error there.
- The bound of a generic interface may name the type parameters, as in `<T, S: Source<T>>`. The type argument of `S` then gives `T` by its members, as a `Counter` whose `next_value` is of type `() -> Int` gives `T = Int`.
- A parameter of an interface type, `(s: Source<T>)` or `(s: Source<T>?)`, gives its type arguments so from the argument's type too, but not one in which the interface type is a part, as in `Source<T>[]`.

### Type arguments

Type arguments are inferred from the arguments, matched against the parameters' types: an `Int[]` passed as a `T[]`, or an `Int?` as a `T?`, gives `T = Int`. They come, in this order, from:

1. the arguments that have a type of their own;
2. the type the call is expected to have (`xs: String[] = copy([])`);
3. the literals whose type depends on what is expected of them (`[]`, `nil`, `1`, `'a'`, maps, anonymous structs and tuples), each checked against its parameter once the type arguments in it are known;
4. last, function literals, whose parameters may take the types the others give, even where the result's type is still to be inferred from them, as in `xs.map((x) -> x * 2)`.

- An argument for a parameter whose type names no type parameter takes that type as in any call, so that a member of an enum may stand alone there (`encode_json(value, CAMEL_CASE)`).
- The first type given decides a type argument; the others are checked against it: `pair(1, 'a')` is an error at `'a'`.
- The exception: `X?` after `X` makes it `X?`, unless the receiver of a generic method gave `X` (`[1].contains(m[k])` with `m[k]` an `Int?` is an error).
- `nil`, a `throw` and similar values give no type. A type argument that nothing gives must be written.
- Written type arguments come between the name and the parentheses, which are then required: `empty<String>()`, or for a [generic method](objects.md#generic-methods) its own, `xs.map<String>(...)`.
- The types that the type arguments make in the parameters and the result must be valid where the call is. `T[]` with `T = Int?`, an array that cannot hold its items, or `Map<K, V>` with a key type that a [map](types.md#map) cannot have, is an error at the call.
- A type parameter cannot stand for a union member so far.

### Checking at the definition

The body is checked at its definition, called or not, with each type parameter standing for itself: a type of its own, whose members are its bound's alone.

- So `x * 2` in `twice := <T>(x: T) -> x * 2` is an error, `T has no mul, by which * applies`, and `"#{x}"` is one without `T: Stringable`.
- The operators apply to it through the builtin interfaces that give them:

  | Operators | Interface |
  |---|---|
  | `+` and the like | [Add](builtins.md#operators) and the others |
  | `==` | `Equatable` |
  | `<` and the like | `Comparable`, whose `compare` gives `==` too, so that `T: Comparable` satisfies `Equatable` |

- A call in the body through a function value whose last parameter is of a type parameter's type, with named arguments or that argument left out, is checked per instance alone, since no bound tells whether it is a struct (see [a last struct parameter](#a-last-struct-parameter)).

### Checking per instance

The function is also checked once for each distinct set of type arguments, with the type parameters standing for them, as C++ templates are.

- That check gives the instance what its type arguments make of the body, as their members, operators and conversions to interface values.
- It checks what the definition cannot: such calls through a function value, and the types that the body writes, as `Set<T>` for a `T` without hash.
- An error found there names the instance, as in `(in call<Int>)`.
- An instance whose return type is written is checked once the calling module is, as a function is. So its body may use a top-level value declared after the call (which throws if it is not initialized when the body runs).
- One whose return type is inferred is checked at its first call.

#### Limits

| Limit | Error |
|---|---|
| A type argument nests types at most 32 deep, as `Int[][]` nests 3. Instances that call instances of ever deeper type arguments, as `f<T>` calling `f<T[]>`, would never end. | `'f' needs instances without end, each with type arguments nested deeper` |
| A generic function has at most 1000 instances. This stops instances that each call more than one of deeper type arguments, as `f<T>` calling `f<T[]>` and `f<Map<String, T>>`, long before they nest too deep. | `'f' needs more than 1000 instances` |

### Instances

- Each instance is compiled once, as a function of its own (monomorphization).
- Its body reaches a type argument only through its bound, whose members are those of the type argument where it is called, extends in effect there included. These are the instance's witnesses.
- Calls of the same type arguments whose witnesses differ make different instances.

## C functions

```
extern lerta_float_to_string as text_of: (Float) -> String
export extern lerta_unix_time as time: () -> Float
```

- `extern <symbol> as <name>: <function type>` declares a C function by its C symbol, as `name` in the module. Without `as <name>`, its name is the symbol.
- The function is of the runtime or of a file that `lerta build` links with the program (see [the compiler](compiler.md)).
- An extern is declared at the top level and can be exported like a function.
- It is a function value only where a function type is expected (see [function values](#functions-as-values)).

### C types

Its type gives its parameters and result:

| Lerta type | C type |
|---|---|
| `Int` | `int64_t` |
| `Float` | `double`, which must not be NaN, as no `Float` is (see [Float](types.md#float)) |
| `Float32` | `float`, which must not be NaN either |
| `Byte` | `uint8_t` |
| `Bool` | `bool` |
| `Int?` | `LertaOptionalInt`: a `bool present` and an `int64_t value`, in `runtime/lerta.h` |
| a reference | a pointer; an optional one is NULL for nil |
| `Bool?`, `Byte?`, `Float?`, `Float32?` | none: rejected |

- Arguments are borrowed, and a returned reference is owned.
- The result may be `void`, or `never` for a C function that does not return, or returns only after throwing (see [lerta_raise](../internals.md#exceptions)), as `exit` of a code out of range does.

### Agreement

- All the externs of one C symbol in the program, `std:builtins` included, must agree on its C type. An error names the module of the first declaration.
- A `String` and a `Binary`, both pointers, may stand for the same parameter.
- The compiler does not check that the C function exists or has that type: a wrong declaration fails when the program is linked, or misbehaves.
- A wrong type for a runtime function that the compiler also calls itself can make the compiler fail with an internal error.
