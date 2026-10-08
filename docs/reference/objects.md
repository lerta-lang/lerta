# Classes and structs

```
struct Point
  x: Int
  y: Int
  sum = @x + @y
  scaled = (k: Int) -> Point(x: @x * k, y: @y * k)

class Counter
  label: String
  count = 0
  increment = -> @count += 1

const c = Counter(label: 'clicks')
c.increment()
print c.count
```

- `class` and `struct` declare a type at the top level. Its name cannot be the name of a builtin type, a top-level function or another top-level name. Like functions, types can be used anywhere in the module, so they can refer to each other and to themselves (`next: Node?`).
- **Members**, one per line:
  - `name: Type` is a field without an initializer: a constructor argument. If its type is optional, the argument may be left out, and the field is nil.
  - `name = value` or `name: Type = value` is a field computed at construction from its initializer.
  - `name = (params) -> body` is a method. `init`, which takes no parameters, runs at the end of construction. In a class, `deinit`, which takes no parameters and gives no value, runs when the object is released (see below).
- **Construction** names its arguments: `Point(x: 1, y: 2)` (there is no positional form). The arguments are assigned first, then the initializers run in declaration order (each sees the arguments and the fields before it), then `init` runs.
- Inside methods, `@` is the object and `@x` its member `x`. An initializer can only use `@` to read a field set before it (`@name`): the object is not complete yet, so it cannot be passed on or have its methods called.
- `p.x` reads a field and `p.m(...)` calls a method.
- **Mutability.** A class field can be assigned (`c.count = 1`) unless it is declared `const`. A struct field cannot be changed, and cannot be declared `var`.
- Objects are reference counted. Assigning or passing an object shares it.
- Objects cannot be compared with `==` yet.

## deinit

```
class File
  path: String
  deinit = -> print "closing #{@path}"
```

- A class's `deinit` runs when its object is released, when the last reference to it goes, before the references its fields hold are released. It cannot be called otherwise. A struct has no `deinit`.
- `deinit` is for cleanup: it may use `@` and call its methods, but must not keep a reference to the object, as in a field of another object; that stops the program with `deinit kept a reference to its object`.
- Objects still referenced when the program ends through `exit` or an uncaught `throw` are not released, so their `deinit` does not run.
