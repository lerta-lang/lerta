# Interfaces

```lerta
import PI from 'std:math'

interface Shape
  name: String
  area: () -> Float

struct Circle
  r: Float
  name := 'circle'
  area := -> PI * @r * @r

struct Rect
  w: Float
  h: Float
  name := 'rect'
  area := -> @w * @h

shapes: Shape[] = [Circle(1), Rect(w: 2, h: 3)]
print "#{shape.name}: #{shape.area().to_fixed(2)}" for shape in shapes
```

```output
circle: 3.14
rect: 6.00
```

An interface lists the members that a type must have. A type that has them satisfies it, without declaring so: `Circle` and `Rect` never name `Shape`. A type may still name it, `struct Circle: Shape`, to have that checked where it is declared.

## Generic functions

```lerta
interface Named
  name: String

longest := <T: Named>(items: T[]) -> items.sorted_by((item) -> -item.name.count()).first()

struct City
  name: String

print longest([City('Rome'), City('Lisbon'), City('Oslo')])?.name else 'none'
```

```output
Lisbon
```

An interface also bounds a type parameter. A generic function is compiled for each type it is called with, so it costs no more than one written for that type.

For the rules, see [interfaces](../reference/objects.md#interfaces) and [generic functions](../reference/functions.md#generic-functions).
