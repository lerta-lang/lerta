# Functions

## Declaring a function

```lerta
square := (x: Int) -> x * x

gcd := (a: Int, b: Int): Int ->
  return a if b == 0
  gcd(b, a % b)

print square(7)
print gcd(84, 36)
```

```output
49
12
```

A function is declared as any name is, with `:=`: its value is a function literal, `(<parameters>) -> <body>`. The body is an expression on the line of `->`, or an indented block whose last statement gives the result. The return type is inferred, except for a recursive function such as `gcd`, which writes it after the parameters.

## Defaults and named arguments

```lerta
greet := (name: String, greeting = 'hello') -> "#{greeting}, #{name}"

struct Box
  width: Int
  height := 1

print greet('Ana')
print greet('Bo', 'hi')
box := Box(width: 3, height: 2)
print box.width * box.height
print Box(5).height
```

```output
hello, Ana
hi, Bo
6
1
```

A parameter may have a default. A struct is constructed with named arguments, which may leave out its members with a value, or with the value alone of its one member that must be given (see [structs](structs.md)).

## Function values

```lerta
twice := (f: (Int) -> Int, x: Int) -> f(f(x))

print twice((x) -> x + 3, 10)
print [3, 1, 2].sorted_by((x) -> -x)
```

```output
16
[3, 2, 1]
```

A function is a value of a type such as `(Int) -> Int`. A function literal passed where that type is expected leaves out the types of its parameters, which it takes from there.

```lerta
counter := ->
  var count = 0
  ->
    count += 1
    count

next := counter()
print next()
print next()
```

```output
1
2
```

A literal captures the names it uses, and keeps them alive while it lives.

For the rules, see [functions](../reference/functions.md).
