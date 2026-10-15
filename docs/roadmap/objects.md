# Objects

The planned design of classes and structs, interfaces, generics and equality.

## Classes and structs

- A function literal member declared `var`, `var on_hover = -> log 'hover'`, is a function field held per instance, so that it can be replaced (class only). A `const` one (the default) is a method. The difference in representation follows from whether reassignment is allowed.
- Constructing a class or struct, `Circle(r: 1)`, is also a call to a constructor that takes an anonymous struct with the type-only fields.
- Definite assignment analysis in place of the rule for field initializers, which may read only the fields set before them through `@` ([the reference](../reference/objects.md#classes-and-structs)): `@` still cannot leak before all the fields are initialized, but an initializer may use it otherwise, as by calling a method that reads only those fields.
- Classes, structs, enums and type aliases declared inside a function, visible in its scope. Their methods and initializers do not see the function's locals, so that a type does not become a closure; `export`, `import`, `extend` and `extern` stay at the top level, where a module's names and the reach of its extends are decided.

## Interfaces

What is implemented, interfaces as bounds and as types of values, is in [the reference](../reference/objects.md#interfaces). Planned:

- Unions converted to interface values, each member with its itab, chosen when the value is converted.
- Values of `Int`, `Bool`, `Byte` and enums in interface values, which are not references: the itab then tells whether the data is one.

## Generics

- The body of a generic function or method is **checked at definition** against its bounds, instead of per instance (avoiding the C++ template "error deep inside").
- Generic function literals outside the top level.
- Bounds on the type parameters of generic classes and structs, `class Sorted<T: Comparable>`, checked wherever the type is written.

## Equality

- User-defined `equals` and `hash`, which `==` and maps use. A class that defines `equals` is `Hashable` only if it also defines `hash` (preventing the mistake of equal values with different hashes).
- `==` on interface values, and interface values as `Map` keys, by the equality of the values they hold.

## Open questions

- Whether an extend should be in effect beyond the modules that import its module directly.
- Whether a class or struct may name several interfaces it satisfies (`struct S: A, B`), and what it does when two give a field of the same name.
- Whether an interface may declare a writable member (`var count: Int`, satisfied only by a class's `var` field). Its members are read-only for now (see [the reference](../reference/objects.md#interfaces) for why); reconsider if that proves limiting.
- How to handle conversion from an interface value to another interface (the concrete type is unknown until run time, so a static itab is not enough; forbid it or generate at run time).
