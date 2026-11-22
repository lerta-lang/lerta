# Structs

## Fields and methods

```lerta
struct Point
  x: Int
  y: Int

  sum := -> @x + @y
  scaled := (k: Int) -> Point(x: @x * k, y: @y * k)

p := Point(x: 1, y: 2)
print p.sum()
print p.scaled(3)
print p == { x: 1, y: 2 }
```

```output
3
Point(x: 3, y: 6)
true
```

A struct is a value made of fields, which never change. Inside a method, `@` is the struct, and `@x` its field `x`. Structs are compared and printed by their fields.

## Defaults and construction

```lerta
struct Options
  name: String
  retries := 3
  verbose := false

a := Options('build')
b := Options(a..., verbose: true)
print a.retries
print b
```

```output
3
Options(name: 'build', retries: 3, verbose: true)
```

A field with a value is an argument that may be left out. `a...` takes from `a` the fields that are not given, which makes a modified copy.

Where the type is known, `{ ... }` constructs a struct too:

```lerta
struct Size
  width: Int
  height: Int

area := (size: Size) -> size.width * size.height
print area({ width: 2, height: 3 })
```

```output
6
```

## extend

```lerta
extend String
  shout := -> @to_upper() + '!'

extend Int
  is_even := -> @ % 2 == 0

print 'hello'.shout()
print 4.is_even()
```

```output
HELLO!
true
```

`extend` adds methods to a type, including builtin types such as `String` and `Int`, in its own module and in the modules that import it.

For the rules, see [objects](../reference/objects.md).
