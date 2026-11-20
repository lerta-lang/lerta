# Enums and unions

## Enums

```lerta
enum Light
  RED
  YELLOW
  GREEN

next := (light: Light): Light ->
  case light
    when RED then GREEN
    when GREEN then YELLOW
    when YELLOW then RED

var light: Light = RED
for _ in 0..4
  print light
  light = next(light)
```

```output
RED
GREEN
YELLOW
RED
```

An enum's values are its members. Where an enum is expected, a member is written alone. A `case` that names every member needs no `else`, and one that misses a member is an error.

## Unions

```lerta
struct Num
  value: Int

struct Add
  left: Expr
  right: Expr

struct Neg
  operand: Expr

type Expr = Num | Add | Neg

eval := (e: Expr): Int ->
  case e
    when Num then e.value
    when Add then eval(e.left) + eval(e.right)
    when Neg then -eval(e.operand)

print eval(Add(left: Num(1), right: Neg(Num(5))))
```

```output
-4
```

A union, `Num | Add | Neg`, is a value of any of its types, and needs no tag to tell which: a `case` chooses by type, and in each arm `e` is of that type. As with enums, every type must be handled.

`is` tests the type of a union too, and narrows the same way:

```lerta
describe := (value: Int | String) ->
  value is String then "a string of #{value.count()}" else "the number #{value}"

print describe('abc')
print describe(42)
```

```output
a string of 3
the number 42
```

For the rules, see [enums](../reference/types.md#enums), [unions](../reference/types.md#unions) and [case](../reference/control-flow.md#case-with-a-subject).
