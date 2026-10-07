# Functions

```
const gcd = (a: Int, b: Int): Int ->
  return a if b == 0
  gcd(b, a % b)

const square = (x: Int) -> x * x
const greet = -> print 'hello'
```

- A function is declared as a top-level `const` whose value is a function literal `(<parameters>): <return type> -> <body>`. So far, functions can be declared only at the top level, and cannot be used as values.
- Parameters are `name: Type`. With no parameters, `()` may be omitted.
- The body follows `->` on the same line, or as an indented block. Its last statement, if an expression, is the return value; `return <value>` returns early, and `return` alone returns from a function without a value.
- The return type may be omitted; it is then the type of the returned values, which must all agree, or `void` if there are none. A recursive function must write its return type.
- A function whose return type is not `void` must end with its return value or a `return`. This is decided by the last statement alone: a body ending in `while true` or in an `if` whose branches all return still needs a final value.
- Top-level functions can be used anywhere in the module, before their declaration too, so they can call each other recursively.
- A function body sees its parameters, its own locals, top-level functions and builtins. It does not see the top-level `const`s and `var`s of the program, or the locals around it (closures are not implemented yet).

## Types

Type names: `Int`, `UInt8` (or `Byte`), `Bool`, `String`, `Binary`, `Array<T>`, and `void` as a return type.
