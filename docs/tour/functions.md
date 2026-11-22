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

A function is declared as any name is, with `:=`: its value is a function literal, `(<parameters>) -> <body>`. The body is an expression on the same line as `->`, or an indented block whose last statement gives the result. The return type is inferred, except for a recursive function such as `gcd`, where it is written after the parameters.

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

A parameter may have a default. A function's own arguments are positional. A struct is constructed with named arguments, and the members that have a value of their own may be left out. If only one member must be given, its value may be written alone, as in `Box(5)` (see [structs](structs.md)).

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

A function is a value of a type such as `(Int) -> Int`. A function literal passed where that type is expected leaves out the types of its parameters, which come from the expected type.

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

A function literal captures the variables it uses, and keeps them alive for as long as it lives.

For the rules, see [functions](../reference/functions.md).
