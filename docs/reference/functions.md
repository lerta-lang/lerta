# Functions

```
const gcd = (a: Int, b: Int): Int ->
  return a if b == 0
  gcd(b, a % b)

const square = (x: Int) -> x * x
const greet = -> print 'hello'
```

- A function is declared as a top-level `const` whose value is a function literal `(<parameters>): <return type> -> <body>`. So far, functions can be declared only at the top level.
- Parameters are `name: Type`. With no parameters, `()` may be omitted.
- The body follows `->` on the same line, or as an indented block. Its last statement, if an expression, is the return value; `return <value>` returns early, and `return` alone returns from a function without a value.
- The return type may be omitted; it is then the type of the returned values, which must all agree, or `void` if there are none. A mix of `T`, `T?` and `nil` gives `T?`; `nil` alone does not give a type, so the return type must then be written. A recursive function must write its return type.
- A function whose return type is not `void` must end with its return value or a `return`. This is decided by the last statement alone: a body ending in `while true` or in an `if` whose branches all return still needs a final value.
- Top-level functions can be used anywhere in the module, before their declaration too, so they can call each other recursively.
- A top-level function's body sees its parameters, its own locals, the top-level functions, `const`s and `var`s of its module, and builtins. It does not see the locals of blocks at the top level, such as those of an `if`.
- A top-level value read or assigned by a function or a method before the top-level code has initialized it throws `'<name>' is used before it is initialized`. Its type must be known where it is used: if top-level code above its declaration calls a function whose return type is inferred, or constructs an object whose field type is inferred from an initializer, and that function or initializer uses the value, it is an error; move the declaration up, or write the type of the function or field.

## Function values

```
const apply = (f: (Int) -> Int, x: Int): Int -> f(x)
print apply(double, 4)
const steps: Array<(Int) -> Int> = [double, square]
```

- A function is a value of the function type `(<parameter types>) -> <return type>`, such as `(Int, String) -> Bool` or `() -> void`. To make it optional, put it in parentheses: `((Int) -> Int)?`.
- The name of a top-level function, without a call, is its value. It can be stored, passed, returned and kept in arrays, maps and fields like any value, but not compared or printed.
- A function value fits only where its type is expected exactly: `(Int) -> Int` does not fit where `(Int) -> Int?` is expected.
- Calling a value of a function type calls the function it holds: `f(x)`, `make()(x)`, and `button.on_press(x)` for a field that holds a function.
- Builtins (`print`), standard modules' functions and methods can only be called so far, not used as values.

## Function literals

```
const make_adder = (n: Int): (Int) -> Int -> (x) -> x + n
print map([1, 2, 3], (x) -> x * x)
```

- A function literal can be written wherever a value is expected; outside the top level, `const f = (x: Int) -> x + 1` declares a local that holds one. Each evaluation gives a function with the values captured then.
- Where a function type is expected (a parameter, an annotation, a return type), the literal's parameter types and return type may be left out and are taken from it: `(x) -> x * 2`. Otherwise the parameters' types must be written.
- A function literal sees the locals around it, and captures their values when it is evaluated: `n` above keeps the value it had when `make_adder` was called. It can capture a `const`, a parameter or a loop variable, narrowed as it is there, but not a `var` so far; copy one into a `const` first. It cannot use `@` so far.
- `return` in a function literal returns from the literal; `break` and `continue` cannot leave a loop around it.

## Types

Type names: `Int`, `UInt8` (or `Byte`), `Bool`, `String`, `Binary`, `Array<T>`, `Map<K, V>`, function types, the names of classes and structs, and `void` as a return type.
