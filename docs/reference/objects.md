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
  - `name: Type` is a field without an initializer: a constructor argument. If its type is optional, the argument may be left out, and the field is nil. A field may hold a function (`on_click: () -> void`); `b.on_click()` calls it (see [function values](functions.md#function-values)).
  - `name = value` or `name: Type = value` is a field computed at construction from its initializer.
  - `name = (params) -> body` is a method. `init`, which takes no parameters, runs at the end of construction. In a class, `deinit`, which takes no parameters and gives no value, runs when the object is released (see below).
- **Construction** names its arguments: `Point(x: 1, y: 2)` (there is no positional form). The arguments are assigned first, then the initializers run in declaration order (each sees the arguments and the fields before it), then `init` runs. A field with an initializer is not an argument, so that what it computes cannot be overridden from outside.
- Inside methods, `@` is the object and `@x` its member `x`. An initializer can only use `@` to read a field set before it (`@name`): the object is not complete yet, so it cannot be passed on or have its methods called.
- `p.x` reads a field and `p.m(...)` calls a method.
- **Mutability.** A class field can be assigned (`c.count = 1`) unless it is declared `const`. A struct field cannot be changed, and cannot be declared `var`.
- Objects are reference counted. Assigning or passing an object shares it.
- Objects cannot be compared with `==` yet.

## extend

```
extend String
  shout = (): String -> @ + '!'

extend Point
  sum = (): Int -> @x + @y

extend <T> Array<T>
  second = (): T -> @[1]

print 'hi'.shout()
print [1, 2].second()
```

- `extend Type` at the top level, followed by an indented block of methods, written as a class's, gives a type more methods. Inside them, `@` is the receiver. An extend has no fields, and no `init` or `deinit`.
- Only `String`, `Int`, `Bool`, `Byte`, `Binary`, arrays, maps, `Iter`s, classes and structs can be extended so far. Extending an optional, a function, a union or an anonymous struct type is an error.
- **Generic extends.** `extend <T> Type` declares type parameters, as a generic function does, which the extended type must use and which take no bound: `extend <T> Array<T>` gives its methods to every array, `extend <V> Map<String, V>` to the maps whose keys are `String`s, and `extend <T> Array<Array<T>>` to the arrays of arrays, while `extend Array<Int>` gives them to `Array<Int>` only. In the methods, the type parameters stand for the receiver's type arguments.
- **Generic methods.** The methods of a generic extend, and those that declare type parameters of their own, as `map = <U>(f: (T) -> U): Iter<U> -> (f(x) for x in @)` does, are generic: the receiver gives the extend's type arguments, and the arguments give the method's own, which may have the bound `Stringable`, as those of a generic function are inferred (see [generic functions](functions.md#generic-functions)). Like a generic function, each is checked and compiled per instance, for each receiver type and set of type arguments; an error in its body names the instance, as in `(in Array<String>.total)`. A generic method takes no named arguments so far.
- An extend is in effect in the module that declares it and in the modules that import that module directly, by any import, `import 'module'` included (see [modules](modules.md)). It is not in effect further: a module that imports one of those does not get it.
- It is an error, at the extend's method, for the method to have the name of a member that the type has already, builtin or of its class or struct, or of a method that another extend in effect in the module gives the same type; extends of a generic type give the same type a method when some type matches both, as `Array<Int>` matches both `extend <T> Array<T>` and `extend Array<Int>`. When two imported modules' extends conflict, the error is at the second import.

## deinit

```
class File
  path: String
  deinit = -> print "closing #{@path}"
```

- A class's `deinit` runs when its object is released, when the last reference to it goes, before the references its fields hold are released. It cannot be called otherwise. A struct has no `deinit`.
- `deinit` is for cleanup: it may use `@` and call its methods, but must not keep a reference to the object, as in a field of another object; that stops the program with `deinit kept a reference to its object`.
- Objects still referenced when the program ends through `exit` or an uncaught `throw` are not released, so their `deinit` does not run.
