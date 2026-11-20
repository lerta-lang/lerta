# Modules

## Imports

```lerta
import sqrt from 'std:math'
import encode_json from 'std:json'

struct Point
  x: Float
  y: Float

p := Point(x: 3, y: 4)
print sqrt(p.x * p.x + p.y * p.y)
print encode_json(p)
```

```output
5.0
{"x":3.0,"y":4.0}
```

A file is a module. `import` names what it takes from another, from a standard module, `std:<name>`, or from a file relative to the importing one, `'./geometry'`. There is no `import *`, so each name in a module says where it comes from.

## Exports

```
# geometry.lerta
export struct Point
  x: Float
  y: Float

export distance := (a: Point, b: Point) -> ...

# main.lerta
import distance, Point from './geometry'
```

A module exports what it marks `export`, and keeps the rest to itself.

## Some standard modules

| Module | For |
|---|---|
| `std:io` | files, directories and the standard streams |
| `std:process` | arguments, the environment, exit, and running other programs |
| `std:path` | paths |
| `std:json` | JSON, for types of data |
| `std:http` | an HTTP server and client |
| `std:net` | TCP and UDP |
| `std:time` | clocks and sleeping |
| `std:async` | waiting on several promises |
| `std:math` | mathematical functions |
| `std:args` | command-line options, parsed into a struct |

For the rules, see [modules](../reference/modules.md) and [the standard modules](../reference/std.md).
