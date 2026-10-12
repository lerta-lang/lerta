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

- `class` and `struct` declare a type at the top level. Its name cannot be the name of a builtin type, a top-level function or another top-level name: types and values share one namespace (`class A` then `const A = 1` is an error, `'A' is already defined`). Like functions, types can be used anywhere in the module, so they can refer to each other and to themselves (`next: Node?`).
- **Members**, one per line:
  - `name: Type` is a field without an initializer: a constructor argument. If its type is optional, the argument may be left out, and the field is nil. A field may hold a function (`on_click: () -> void`); `b.on_click()` calls it (see [function values](functions.md#function-values)).
  - `name = value` or `name: Type = value` is a field computed at construction from its initializer.
  - `name = default value` or `name: Type = default value` is a constructor argument that may be left out; the field then has the value, computed as an initializer would be, in its place. `default` is not a keyword: it marks a default only when an operand follows it, as an argument follows a call without parentheses (see [calls](syntax.md#calls)): `default -1` is a default, and `default - 1` a subtraction.
  - `weak! name: Type` is a field of a class that holds an object of a class without keeping it alive, so that two objects that refer to each other, as a parent and its children, are freed. It is a constructor argument, which cannot be assigned afterwards. Reading it gives the object, of type `Type`, or throws `weak object is gone` once the object is freed, including while the object's `deinit` runs. `weak` is not a keyword.
  - `name = (params) -> body` is a method, which may be generic, as `apply = <T>(f: (Int) -> T): T -> f(@n)` (see [generic methods](#extend)). `init`, which takes no parameters and no type parameters, runs at the end of construction. In a class, `deinit`, which takes no parameters and gives no value, runs when the object is released (see below).
- **Generic classes and structs.** `class Stack<T>` or `struct Pair<A, B>` declares type parameters, which take no bound so far, and its type is written with as many type arguments, `Stack<Int>`. Each set of type arguments makes an instance, whose fields have the types they give and whose methods are generic methods with those type arguments (see [generic methods](#extend)); an instance is checked and compiled for its own, as a generic function is. Constructing one takes the type arguments written, `Stack<Int>()`, or else those that the expected type and the arguments give, as a generic function's are inferred (see [generic functions](functions.md#generic-functions)): `Pair(first: 1, second: 'a')` is a `Pair<Int, String>`. Instances of different type arguments are different types: a `Stack<Square>` is no `Stack<Shape>`.
- **Construction** names its arguments: `Point(x: 1, y: 2)` (there is no positional form). A name alone is short for an argument of that name, as in an [anonymous struct](types.md#anonymous-structs): `Point(x, y: 2)` is `Point(x: x, y: 2)`; such arguments come before the others. The arguments given are assigned first, then the initializers and the defaults of the arguments left out run in declaration order (each sees the arguments and the fields before it), then `init` runs. A field with an initializer is not an argument, so that what it computes cannot be overridden from outside, unless it is marked `default`.
- Inside methods, `@` is the object and `@x` its member `x` (`@.x` is an error). An initializer can only use `@` to read a field set before it (`@name`): the object is not complete yet, so it cannot be passed on or have its methods called.
- `p.x` reads a field and `p.m(...)` calls a method.
- **Mutability.** A class field can be assigned (`c.count = 1`) unless it is declared `const`. A struct field cannot be changed, and cannot be declared `var`.
- Objects are reference counted, with no cycle collector. Assigning or passing an object shares it, and may retain it; whatever optimization can remove is removed. A struct can be part of a cycle only through something mutable it holds (an array, a map, a class object, or a function that captures a `var`), so immutable data is recommended.
- A struct is immutable, so copying it and sharing it cannot be told apart. The implementation may choose either (see [internals](../internals.md#structs-planned)).
- There are no static members (`static`). Functions related to a type are module functions; `extend` adds methods to a type, but not functions without a receiver.
- Why a function literal member is a method, one per type with `@` passed at call time, rather than a field holding a closure: closures capturing `@` would create a cycle in every object.
- **Equality.** Objects of a class compare by identity: `a == b` tells whether `a` and `b` are the same object, whatever their fields hold, and `!=` the opposite. The two sides may have different types, a class and a union or two unions, as long as both can hold objects of some class. Either side may be optional, compared as other [optional values](types.md#optional-values) are. Classes, and unions of classes, can also be [`Map`](types.md#map) keys, by identity.
- Structs compare by their contents: two are equal when they are of the same type and each field is equal as `==` compares it (a field of a class as the same object). Anonymous structs and arrays compare so too, and so do unions that hold them, whose values are equal when they are of the same member type and equal as it. A type whose part `==` does not compare, such as a function, cannot be compared. Such values can be `Map` keys, hashed by their contents; a key's arrays must not change while it is in a map, or it is no longer found. A value is equal to itself at once, but a value that holds itself through an array cannot be hashed, as a map key, nor compared with another such value: neither ends, and the program stops with a stack overflow.

## extend

```
extend String
  shout = (): String -> @ + '!'

extend Point
  sum = (): Int -> @x + @y

extend<T> Array<T>
  second = (): T -> @[1]

print 'hi'.shout()
print [1, 2].second()
```

- `extend Type` at the top level, followed by an indented block of methods, written as a class's, gives a type more methods. Inside them, `@` is the receiver. An extend has no fields, and no `init` or `deinit`.
- Only `String`, `Int`, `Bool`, `Byte`, `Binary`, arrays, maps, `Iter`s, classes, structs and [interfaces](#interfaces) can be extended so far. Extending an optional, a function, a union, an anonymous struct or a tuple type is an error.
- **Extends of interfaces.** `extend<T> Source<T>`, or `extend Equatable`, gives its methods to every type that satisfies the interface, including the interface type itself; its type parameters are those of the interface's type arguments, which the type gives by its members (see [generic functions](functions.md#generic-functions)), and `Self` is the type, as in the interface. In the methods, `@` is of the type, and each method is checked and compiled for each type it is called on, as a generic method is. A method cannot have the name of a member of the interface, and does not count for satisfying an interface. A type that has a member of the name already, of its own or from an extend of a type, cannot call the method: the call is ambiguous, an error. Extends of two interfaces cannot give methods of the same name where both are in effect, since a type may satisfy both.
- Why extends rather than default implementations in the interface: the interface says only what a type must have, and a method of an extend cannot be overridden, so which code runs never depends on whether the type declares a member.
- **Generic extends.** `extend<T> Type` declares type parameters, as a generic function does, which the extended type must use and which take no bound: `extend<T> Array<T>` gives its methods to every array, `extend<V> Map<String, V>` to the maps whose keys are `String`s, and `extend<T> Array<Array<T>>` to the arrays of arrays, while `extend Array<Int>` gives them to `Array<Int>` only. In the methods, the type parameters stand for the receiver's type arguments.
- **Generic methods.** The methods of a generic extend, and the methods of extends, classes and structs that declare type parameters of their own, as `map = <U>(f: (T) -> U): Iter<U> -> (f(x) for x in @)` does, are generic: the receiver gives the extend's type arguments, and the arguments give the method's own, which may have the bound `Stringable`, as those of a generic function are inferred (see [generic functions](functions.md#generic-functions)). Like a generic function, each is checked and compiled per instance, for each receiver type and set of type arguments; an error in its body names the instance, as in `(in Array<String>.total)`. A generic method takes no named arguments so far.
- An extend is in effect in the module that declares it and in the modules that import that module directly, by any import, `import 'module'` included (see [modules](modules.md)). It is not in effect further: a module that imports one of those does not get it.
- It is an error, at the extend's method, for the method to have the name of a member that the type has already, builtin or of its class or struct, or of a method that another extend in effect in the module gives the same type; extends of a generic type give the same type a method when some type matches both, as `Array<Int>` matches both `extend<T> Array<T>` and `extend Array<Int>`. When two imported modules' extends conflict, the error is at the second import.

## Interfaces

```
interface Shape
  area: () -> Int
  name: String

struct Square
  side: Int
  name = 'square'
  area = (): Int -> @side * @side

const describe = <T: Shape>(shape: T) -> print "#{shape.name}: #{shape.area()}"

describe Square(side: 3)
describe { name: 'dot', area: -> 0 }

const shapes: Array<Shape> = [Square(side: 2), { name: 'dot', area: -> 0 }]
print shape.area() for shape in shapes
```

- `interface Name` at the top level, followed by an indented block of members, `name: Type`, one per line, declares what a type must have to satisfy it. Its name is in the namespace of types and values, as a class's is.
- **Generic interfaces.** `interface Source<T>` declares type parameters, which take no bound, and its type is written with as many type arguments, `Source<Int>`. A type satisfies it with the type arguments in the members' types.
- **`Self`** in the members stands for the type that satisfies the interface: `equals: (Self) -> Bool` is satisfied by a `Point` with `equals: (Point) -> Bool`. An interface whose members name `Self` can only bound type parameters, not be a type of values, since its values could not tell which type `Self` is.
- A type **satisfies** an interface when it has, for each member, a method, a field or a property of the member's name and of exactly its type. Nothing needs to declare that it does (structural typing). A method may come from an extend in effect where it is checked; one with type parameters of its own has no one type, and satisfies no member. A function member, such as `area: () -> Int`, is satisfied alike by a method and by a field that holds a function. A union satisfies a member by a field that every member of it has, of the member's type, as it is read through the union (see [unions](types.md#unions)).
- **Declaring an interface.** `struct IndexError: Error` or `class Counter: Source<Int>` names an interface that the class or struct satisfies, which is checked where it is declared. Each member of the interface that the type's own members do not declare becomes a field of the member's type, a constructor argument, before the type's own fields; so `struct IndexError: Error` alone, without a body, declares a struct with a `message: String`. Such a field follows the rules of the type's others: it can be assigned in a class, not in a struct. A method of an extend of the type cannot stand for such a member, which is a field already. The interface may name `Self`, as a bound may. The type still satisfies other interfaces by its members alone, and only one interface can be named so far.
- An interface bounds type parameters (see [generic functions](functions.md#generic-functions)), and is also a type of values: an **interface value** holds a value of a type that satisfies it, through which `shape.area()` and `shape.name` read the members. A value converts to an interface type, or to one optional, where one is expected, as a value converts to an optional type, provided that its type satisfies the interface where it is converted; the extends in effect there give the members. An interface type satisfies itself, so an interface value can be given to a type parameter that the interface bounds.
- So far only references convert to interface values, not `Int`, `Bool`, `Byte` or enum values, and a union does not convert, nor does an interface value to another interface. Interface values cannot be compared with `==`, nor be map keys, and C functions cannot take or return them.
- Members are read-only: an interface has no member that must be assignable, so its members are written without `const` or `var`, and have no value, and an interface value's members cannot be assigned. A function member is called, as a method is, not read as a value.
- Why read-only: a struct's field, a `const` field and a method cannot be assigned, so an assignable member would leave them out, and an assignment whose meaning depended on how the member is satisfied would be a setter.
- Why exactly the member's type, not one assignable to it: the generic code is checked with the type the member has (see [generic functions](functions.md#generic-functions)), so a `String` field for a member `name: String?` would fail in that code rather than where the type is given.

## deinit

```
class File
  path: String
  deinit = -> print "closing #{@path}"
```

- A class's `deinit` runs when its object is released, when the last reference to it goes, before the references its fields hold are released. It cannot be called otherwise, and cannot throw (`deinit cannot throw`); an exception that a call in it throws makes a panic, `deinit threw an exception`, since no code that releases the object could take it. A struct has no `deinit`.
- Why a struct has no `deinit` and no `weak!` fields: if the time of its release were observable, the implementation could no longer choose between copying and sharing it. Breaking cycles is not needed for structs either.
- `deinit` is for cleanup: it may use `@` and call its methods, but must not keep a reference to the object, as in a field of another object; that stops the program with `deinit kept a reference to its object`.
- Objects still referenced when the program ends through `exit` or an uncaught `throw` are not released, so their `deinit` does not run.
