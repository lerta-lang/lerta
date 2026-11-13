# Objects

## Classes and structs

```lerta
struct Point
  x: Int
  y: Int
  sum := @x + @y
  scaled := (k: Int) -> Point(x: @x * k, y: @y * k)

class Counter
  label: String
  var count = 0
  increment := -> @count += 1

c := Counter(label: 'clicks')
c.increment()
print c.count
```

- `class` and `struct` declare a type at the top level.
- Types and values share one namespace (see [blocks and scopes](control-flow.md#blocks-and-scopes)): `class A` then `A := 1` is an error, `'A' is already defined`. A type may shadow a builtin.
- Like functions, types can be used anywhere in their module, so they can refer to each other and to themselves (`next: Node?`).
- A class and a struct differ only in what a class adds: `var` and weak fields, `deinit`, and comparison by identity.

### Members

The members of a type, one per line, are declared as locals are (see [declarations](syntax.md#declarations-and-assignment)).

| Declaration | Member |
|---|---|
| `name: Type` | A field set by a constructor argument. If `Type` is optional, the argument may be left out and the field is nil. |
| `name := value`, `name: Type = value` | A field computed at construction. It is not a constructor argument. |
| `name := default value`, `name: Type = default value` | A constructor argument that may be left out; the value is then computed as an initializer. `default` is not a [keyword](syntax.md#contextual-words). |
| `var` before any of the above | A field of a class that can be assigned (see [mutability](#mutability)). |
| `weak name: Type?`, `weak name: Type!`, either with `weak var` | A [weak field](#weak-references). |
| `name := (params) -> body` | A method (see below). |
| `pass` alone | No members: a type without them, as an empty struct (see [pass](syntax.md#pass)). |

- A field may hold a function (`on_click: () -> void`); `b.on_click()` calls it (see [function values](functions.md#function-values)).
- `name = value` in a type body is an error, as it reads as an assignment: `write 'name := value' to declare a member`.
- Inside methods, `@` is the object and `@x` its member `x`; `@.x` is an error.
- An initializer can use `@` only to read a field set before it (`@name`). The object is not complete yet, so it cannot be passed on, and its methods cannot be called.
- `p.x` reads a field; `p.m(...)` calls a method.
- There are no static members. Write functions related to a type as module functions. `extend` adds methods, not functions without a receiver.

#### Methods

- A method cannot be `var`.
- A method may be generic: `apply := <T>(f: (Int) -> T): T -> f(@n)` (see [generic methods](#generic-methods)).
- `init` takes no parameters and no type parameters, and gives no value: its last expression is a statement. It runs at the end of construction.
- `deinit`, in a class only, takes no parameters and gives no value. It runs when the object is released (see [deinit](#deinit)).
- Why a function literal member is a method, with `@` passed at call time, rather than a field that holds a closure: closures that capture `@` would make a cycle in every object.

### Construction

- Arguments are named: `Point(x: 1, y: 2)`.
- **A value alone.** If a construction must give exactly one argument, that argument may be written alone, as the only argument: `ValueError('failed')` is `ValueError(message: 'failed')`. Arguments with defaults or of optional types do not count. If any other argument is written, all are named.
  - Why: a name tells apart the values of several arguments but adds nothing to a single one, such as `message:` to an error. Counting only the required arguments lets a type add an argument with a default without breaking its constructions.
- **Shorthand.** A name alone is short for the argument of that name, as in an [anonymous struct](types.md#anonymous-structs): `Point(x, y: 2)` is `Point(x: x, y: 2)`. Such arguments come before the others. Where a value alone is also taken, a name of an argument is still the shorthand for that argument.
- **Spread.** `Point(p..., x: 1)`, with the spread first, takes the arguments not written from `p`.
  - `p` must be a value of the type constructed, not optional, and a name, `@`, or a path of fields from one.
  - Fields that are not arguments are computed again.
  - For a class, it constructs a new object, which shares what the fields hold.
- **Order.** The arguments given are assigned first. Then the initializers, and the defaults of the arguments left out, run in declaration order; each sees the arguments and the fields before it. Then `init` runs.
- A field with an initializer is not an argument, unless it is marked `default`, so that what it computes cannot be overridden from outside. Giving it is an error that suggests `default`.
- A field is computed once. One of a class whose initializer reads a `var` field keeps the value that field had then, which a warning tells, suggesting a method, `double := -> @count * 2`, that reads it each time. Not an initializer of a `var` field or a default, which only start from it, nor a function literal in an initializer, which reads it when called.
- Where a struct is expected, `{ x: 1, y: 2 }` constructs it too (see [anonymous structs](types.md#anonymous-structs)).

#### A construction that throws

- If an initializer, a default or `init` throws, the fields are released and the object is freed without running its `deinit`. A weak reference to it then reads nil.
- An initializer cannot pass the object on, but `init` can, as by `registry.items.push @` or by throwing the object itself. If anything else still holds the object when `init` throws, the program panics with `init threw an exception after its object escaped: <message>`, since that holder would be left with a freed object (see [panics](errors.md#panics)).
- References held by the object's own fields, such as a child's to its parent, do not count: they go with the object.

### Mutability

- A class field declared `var` can be assigned (`c.count = 1`). No other field can.
- A struct field cannot be changed or declared `var`.
- Why fields are const by default: most fields are never assigned after construction, so `var` marks the few that are, as among locals. A const field can also be narrowed (see [narrowing](control-flow.md#narrowing)).

### Reference counting

- Objects are reference counted, with no cycle collector.
- Assigning or passing an object shares it, and may retain it; optimization removes what it can.
- A struct can be part of a cycle only through something mutable it holds: an array, a map, a class object, or a function that captures a `var`. Immutable data is recommended.
- A struct is immutable, so copying and sharing it cannot be told apart, and the implementation may do either (see [the roadmap](../roadmap/objects.md#classes-and-structs)).

### Weak references

A weak reference holds an object of a class without keeping it alive, so that objects that refer to each other, such as a parent and its children, are freed.

- **`weak name: Type?`** is a field of a class. It reads as the object, or nil once the object is freed. `weak var` makes it assignable. It may be a constructor argument or be computed, as any field.
  - Its type is written: an optional class, which cannot be a type parameter so far.
- **`weak name: Type!`** is a field for an object that should outlive its holder. `weak var` makes it assignable.
  - It reads as a `Type`, a class. `!` is written as in `x as T!`, and only after a weak field's type.
  - It is a constructor argument, without an initializer.
  - Reading it throws `weak object is gone` once the object is freed, including while the object's `deinit` runs.
- **`weak name := value`** and **`weak var name = value`** declare a weak local, in a function or in a block of top-level code; a top-level value cannot be weak.
  - Its type is the class's optional type, `Button?`; an annotation must write it so.
  - It reads as nil once the object is freed, so it is never narrowed: after `weak seen := button`, write `if alive := seen` to take the object.
  - A function literal that captures it captures it weakly too. To capture `@` weakly, a [weak function literal](functions.md#function-literals) is shorter.

### Generic classes and structs

- `class Stack<T>` and `struct Pair<A, B>` declare type parameters. Their types are written with as many type arguments: `Stack<Int>`.
- **Instances.** Each set of type arguments makes an instance. Its fields have the types the arguments give, and its methods are [generic methods](#generic-methods) with those arguments.
- Instances of different type arguments are different types: a `Stack<Square>` is not a `Stack<Shape>`.
- **Construction** takes the type arguments written, `Stack<Int>()`, or else infers them from the expected type and the arguments, as for a generic function (see [generic functions](functions.md#generic-functions)): `Pair(first: 1, second: 'a')` is a `Pair<Int, String>`.
- **Checking.** Field initializers are checked once at the definition, constructed or not, with the type parameters standing for themselves. Each instance is then checked and compiled on its own, as a generic function is.

#### Bounds

- A type parameter may have a bound, as a generic function's may, and the bound may name the type parameters: `struct Source<T, I: Iterable<T>>`.
- The type arguments must satisfy the bounds wherever the type is written or constructed, with the extends in effect there.
- So must the type arguments of the instances that its fields make: `box: Box<T>` in a `Holder<Bool>` makes a `Box<Bool>`.

#### Valid instances

- The types that the type arguments make in the fields must be valid, as in a generic function's signature: `Table<Int?>`, whose `entries: Map<Int, T>` would be a `Map<Int, Int?>`, is an error where it is first written or constructed.
- The depth of type arguments and the number of instances are limited as for generic functions (see [generic functions](functions.md#generic-functions)). This stops members that make instances of ever deeper type arguments without a written type showing it, such as `b = Map<String, A<T[]>>()` in `A<T>`.

#### Growing instances

A member's written type may hold an instance of a generic class, struct or interface whose type argument holds a type parameter inside a larger type, as `Node<T[]>` holds `T`. It is an error when that instance's members lead back to the same type parameter, through the instances they hold in turn, so that instances would grow without end.

| In | Member | Result |
|---|---|---|
| `Node<T>` | `next: Node<Node<T>>?` | Error: leads back to `T` through `Node<Node<T>>` |
| `A<T>` and `B<T>` | `b: B<A<T>>?` and `a: A<B<T>>?` | Error: each leads back to `T` through the other |
| `Pair<A, B>` | `more: Pair<A, A[]>?` | Valid: the `B` of a `Pair` leads to no instance of it |
| `Node<T>` | `next: Node<T>?` | Valid: the type parameter itself is not larger |
| `Pair<A, B>` | `swapped: Pair<B, A>` | Valid: type parameters in any order |
| `Node<T>` | `cache: Node<Int>?` | Valid: no type parameter |

The interface that a class or struct declares counts as such a written type, whether its members use the type argument or not: `class A<T>: Source<A<T[]>>` is an error.

### Equality and order

#### Classes

- Objects of a class compare by identity, unless the class declares `equals` or `compare` (see [custom equality and order](#custom-equality-and-order)): `a == b` tells whether they are the same object, whatever their fields hold, and `!=` the opposite.
- The two sides may have different types, such as a class and a union, or two unions, as long as both can hold objects of some class.
- Either side may be optional, compared as other [optional values](types.md#optional-values) are.
- Classes, and unions of classes, can be [`Map`](types.md#map) keys, by identity.

#### Structs

- Structs compare by content: two are equal when they are of the same type and each field is equal by `==`. A field of a class compares by identity.
- Anonymous structs, arrays, [maps and sets](types.md#equality) compare so too, as do unions that hold them: equal when of the same member type and equal as it.
- A type with a part that `==` does not compare, such as a function, cannot be compared.
- Such values can be `Map` keys, hashed by content. A key's arrays must not change while it is in a map, or the key is no longer found.
- A value that holds itself through an array is equal to itself at once, but it cannot be hashed or compared with another such value: neither ends, and the program stops with a stack overflow.

#### Custom equality and order

A class or struct may declare one of:

- **`equals := (other: T): Bool`**, which `==` and `!=` call wherever its values compare: as a whole, as a struct field, as an array item, as a map key.
- **`compare := (other: T): Ordering`**, which gives `<`, `<=`, `>`, `>=` (`a < b` is `a.compare(b) == LESS`) and `==` (`a == b` is `a.compare(b) == EQUAL`), so that order and equality cannot disagree. The result names a member of `Ordering`, as `Ordering.LESS`, or `LESS` where the written result type tells the enum.

Rules:

- `T` is the type itself, exactly: `equals of Point must be of type (Point) -> Bool, not (Int) -> Bool`.
- `Ordering` is that of std:builtins; a module's own `Ordering` does not stand for it.
- A type cannot have both: `T has both equals and compare, which gives its == too; leave out equals`.
- To be a map key or a set item, the type must also declare `hash := (): Int`, which gives equal values the same hash; otherwise `a set item must hash as it compares` and the like.
- A `hash` without `equals` or `compare` is an error.
- They are methods of the type itself. No extend can declare `equals` or `hash`, which every type that `==` compares already has (`an extend cannot declare equals`), and an extend of a class or struct cannot declare `compare`.
- They cannot throw. An exception that leaves one is a panic, `equals, compare or hash threw an exception`, since `==` and map keys cannot pass it on.
- [Equatable, Comparable and Hashable](builtins.md#equatable-comparable-and-hashable) are the interfaces of these methods.

### Operators

An arithmetic or bitwise operator on a value of a type it does not otherwise apply to calls the type's method of its name. The method may be the type's own or from an extend, or a field of that name that holds a function, read as an interface member is.

| Operator | Method |
|---|---|
| `a + b`, `-`, `*`, `/`, `%` | `a.add(b)`, `sub`, `mul`, `div`, `rem` |
| `&`, `\|`, `^`, `<<`, `>>` | `bit_and`, `bit_or`, `bit_xor`, `shl`, `shr` |
| `a ** b` | `a.pow(b)`, which `**` calls on every type, the numbers too |
| `-a`, `~a` | `a.neg()`, `a.bit_not()` |

- The right operand is the argument, of the parameter's type. The result is whatever the method gives: `Meters / Meters` may give a `Float`.
- The method is found on the left operand: `2 * v` does not call `v`'s `mul`.
- Precedence is that of the operator. New operators cannot be declared.
- `==`, `<` and the like come from `equals` and `compare` (see [custom equality and order](#custom-equality-and-order)).
- `a += b` assigns `a.add(b)`, and so on. Its target is both read and assigned, so it may only be a name, a field, an index or arithmetic: `xs[f()] += v` is an error.
- The builtin interfaces `Add` and the like name these methods for bounds (see [builtins](builtins.md#operators)).

## deinit

```lerta
class File
  path: String
  deinit := -> print("closing #{@path}")
```

- A class's `deinit` runs when its object is released, as the last reference to it goes, before the references its fields hold are released.
- It cannot be called otherwise.
- It cannot throw (`deinit cannot throw`). An exception that a call in it throws is a panic, `deinit threw an exception`, since no code that releases the object could catch it.
- It is for cleanup: it may use `@` and call its methods, but must not keep a reference to the object, as in a field of another object. That stops the program with `deinit kept a reference to its object`.
- Objects still referenced when the program ends through `exit` or an uncaught `throw` are not released, so their `deinit` does not run.
- A struct has no `deinit` and no weak fields. Why: if the time of its release were observable, the implementation could no longer choose between copying and sharing it. Nor do structs need cycles broken.

## extend

```lerta
extend String
  shout := (): String -> @ + '!'

extend Point
  total := (): Int -> @x + @y

extend<T> T[]
  second := (): T -> @[1]

print 'hi'.shout()
print [1, 2].second()
```

- `extend Type` at the top level, followed by an indented block of methods written as a class's, gives a type more methods. Inside them, `@` is the receiver.
- An extend has no fields, and no `init` or `deinit`.
- Only `String`, the numbers, `Char`, `Bool`, `Binary`, arrays, maps, sets, `Iter`s, classes, structs, enums and [interfaces](#interfaces) can be extended so far. Extending an optional, a function, a union, an anonymous struct or a tuple type is an error.

### Scope

- An extend is in effect in the module that declares it and in the modules that import that module directly, by any import, `import 'module'` included (see [modules](modules.md)).
- Through modules that export from it, and from one another, it is also in effect in each of those and in the modules that import one of them (see [exports](modules.md#exports)).
- It goes no further through imports.

### Name conflicts

- A method cannot have the name of a member the type already has, builtin or of its class or struct, or of a method that another extend in effect in the module gives the same type. The error is at the extend's method.
- Extends of generic types give the same type a method when some type matches both, as `Int[]` matches both `extend<T> T[]` and `extend Int[]` (see [generic extends](#generic-extends) for the exception).
- When two imported modules' extends conflict, the error is at the second import.
- A generic extend may give a method the name of a builtin one that only some of the matched types have, as `to_string` of `extend<T> T[]`: those types keep their builtin one.

### Generic extends

- `extend<T> Type` declares type parameters, as a generic function does, and the extended type must use them:
  - `extend<T> T[]`: every array
  - `extend<V> Map<String, V>`: maps with `String` keys
  - `extend<T> T[][]`: arrays of arrays
  - `extend Int[]`: `Int[]` only
- In the methods, the type parameters stand for the receiver's type arguments.
- A type parameter may have a bound, which the receiver's type arguments must satisfy where a method of the extend is used: with `extend<T: Comparable> T[]`, `[true].least()` is an error, `Bool does not satisfy Comparable`.
- Two extends of a type cannot give a method of the same name for different bounds.
- **Overlapping extends** cannot give a method of the same name, except when they are of one module and one of the types has no type parameters. That type takes its own extend's method before the generic one:
  - `extend Int[]` and `extend<T> T[]` of one module may both give `head`; `[5, 6].head()` calls the first, as the generic extend's other methods do.
  - So may `extend Promise[]` and `extend<T> Promise<T>[]`, since `Promise` is a `Promise<T>` without a value.
- Overlapping extends of two modules are an error, since the generic extend's methods, checked in its own module, would call another method than the other module does.
- A `Set<T>` is not a `Map<K, V>`, so their extends do not overlap: an extend of each may give a method of the same name.

### Generic methods

- Generic methods are the methods of a generic extend, and the methods of extends, classes and structs that declare type parameters of their own, such as `map := <U>(f: (T) -> U): Iter<U> -> (f(x) for x in @)`.
- The receiver gives the extend's type arguments. The arguments give the method's own, which may have an interface bound, inferred as for a generic function (see [generic functions](functions.md#generic-functions)).
- Like a generic function, each is checked at its definition, then checked and compiled per instance, for each receiver type and set of type arguments.
- For named arguments in a call of a generic method, see [a last struct parameter](functions.md#a-last-struct-parameter).

### Extends of interfaces

- `extend<T> Source<T>` or `extend Equatable` gives its methods to every type that satisfies the interface, including the interface type itself.
- Its type parameters are those of the interface's type arguments, which the type gives by its members (see [generic functions](functions.md#generic-functions)). `Self` is the type, as in the interface.
- In the methods, `@` is of the type. Each method is checked and compiled for each type it is called on, as a generic method is.
- A method cannot have the name of a member of the interface, and does not count toward satisfying an interface.
- A type that already has a member of the name, its own or from an extend of the type, cannot call the method: the call is ambiguous, an error.
- Extends of two interfaces cannot give methods of the same name where both are in effect, since a type may satisfy both.
- Why extends rather than default implementations in the interface: the interface says only what a type must have, and a method of an extend cannot be overridden, so which code runs never depends on whether the type declares a member.

## Interfaces

```lerta
interface Shape
  area: () -> Int
  name: String

struct Square
  side: Int
  name := 'square'
  area := -> @side * @side

describe := <T: Shape>(shape: T) -> print("#{shape.name}: #{shape.area()}")

describe Square(side: 3)
describe { name: 'dot', area: -> 0 }

shapes: Shape[] = [Square(side: 2), { name: 'dot', area: -> 0 }]
print shape.area() for shape in shapes
```

- `interface Name` at the top level, followed by an indented block of members, `name: Type`, one per line, declares what a type must have to satisfy it.
- It has at least one member; only std:codable's [Codable](std.md#codable) has none.
- Its name shares the namespace of types and values, and may shadow a builtin, as a class's.

### Interface members

- Members are read-only: they are written without `var` and without a value, and an interface value's members cannot be assigned.
  - Why: a struct's field, a class's field that is not `var` and a method cannot be assigned, so an assignable member would leave them out; and an assignment whose meaning depended on how the member is satisfied would be a setter.
- A function member is called, as a method is, not read as a value.
- **`Self`** in the members stands for the type that satisfies the interface: `equals: (Self) -> Bool` is satisfied by a `Point` with `equals: (Point) -> Bool`. An interface whose members name `Self` can only bound type parameters; it cannot be a type of values, since its values could not tell which type `Self` is.

### Satisfying an interface

- A type satisfies an interface when it has, for each member, a method, a field or a property of the member's name and of exactly its type. Nothing needs to declare it (structural typing).
  - Why exactly the member's type, not one assignable to it: generic code is checked with the member's type (see [generic functions](functions.md#generic-functions)), so a `String` field for a member `name: String?` would fail in that code rather than where the type is given.
- A method may come from an extend in effect where the check is made. A method with type parameters of its own has no single type and satisfies no member.
- A function member, such as `area: () -> Int`, is satisfied alike by a method and by a field that holds a function.
- A union satisfies a member by a method that every member of it has, or by a field that every member has, of the member's type, as it is called or read through the union (see [unions](types.md#unions)). A method in some members and a field in others do not.

### Declaring an interface

- `struct IndexError: Error` or `class Counter: Source<Int>` names an interface that the type satisfies, checked where the type is declared.
- Each member of the interface that the type does not declare becomes a const field of the member's type, a constructor argument, before the type's own fields. So `struct IndexError: Error`, without a body, declares a struct with a `message: String`.
- But a member of a function type, a method, must be declared, as a method or as a field: one left out is an error where the type is declared, `Square does not declare 'area', a method of Shape`, which suggests a field `area: () -> Int` for a function that the constructor takes.
  - Why: a method left out would otherwise be a field that the constructor takes, so the error would come only where the type is constructed, as a missing argument.
- A method of an extend of the type cannot stand for such a member.
- The interface may name `Self`, as a bound may.
- The type still satisfies other interfaces by its members alone. Only one interface can be named so far.

### Generic interfaces

- `interface Source<T>` declares type parameters, which take no bound. Its type is written with as many type arguments: `Source<Int>`.
- A type satisfies it with the type arguments in the members' types.
- The types that the type arguments make in the members must be valid, as for a [generic class](#valid-instances): `Source<Int?>`, whose `items: () -> Map<Int, T>` would give a `Map<Int, Int?>`, is an error where it is first written.
- A member's type may not hold larger instances that lead back to it, as for a class (see [growing instances](#growing-instances)).

### Interface values

- An interface bounds type parameters (see [generic functions](functions.md#generic-functions)), and is also a type of values. An interface value holds a value of a type that satisfies it, through which `shape.area()` and `shape.name` read the members.
- A value converts to an interface type, or to its optional type, where one is expected, as a value converts to an optional type. Its type must satisfy the interface where it is converted, with the extends in effect there.
- An interface type satisfies itself, so an interface value can be given to a type parameter that the interface bounds.
- A union converts, whatever its members, as it satisfies the interface by what every member has: a union of `Int` and `String` is a `Stringable`.
- Limits so far:
  - Only references convert to interface values, not `Int`, `Float`, `Bool`, `Byte` or enum values.
  - An interface value does not convert to another interface.
  - Interface values cannot be compared with `==` or be map keys.
  - C functions cannot take or return them.
