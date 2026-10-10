# Objects

The planned design of classes and structs, interfaces, generics, weak references and equality.

## Classes and structs

- A function literal member declared `var`, `var on_hover = -> log 'hover'`, is a function field held per instance, so that it can be replaced (class only). A `const` one (the default) is a method. The difference in representation follows from whether reassignment is allowed.
- Constructing a class or struct, `Circle(r: 1)`, is also a call to a constructor that takes an anonymous struct with the type-only fields.
- `deinit` is synchronous only (no `await`).
- Definite assignment analysis: a class cannot leak `@` before all its fields are initialized, beyond the rule for initializers (see [the reference](../reference/objects.md)).
- Classes, structs, enums and type aliases declared inside a function, visible in its scope. Their methods and initializers do not see the function's locals, so that a type does not become a closure; `export`, `import`, `extend` and `extern` stay at the top level, where a module's names and the reach of its extends are decided.

## Interfaces

What is implemented, interfaces as bounds of type parameters, is in [the reference](../reference/objects.md#interfaces). Planned:

- Interface types of values, as `Array<Shape>`, dispatched through itabs (see [internals](../internals.md#interfaces-planned)). Their members are read through the interface, as the bounds' are; a write goes through the concrete type.
- Default implementations (replacing code reuse through inheritance).
- Inside an interface, `Self` means "the type that implements it".
- Type parameters of interfaces, as `Div<Rhs, Out>` (see [operator overloading](language.md#operator-overloading)).

## Generics

- The body of a generic function or method is **checked at definition** against its bounds, instead of per instance (avoiding the C++ template "error deep inside").
- Generic classes and structs, and generic function literals outside the top level.

## Weak references

- A `weak` field of type `T?` (class only, as `weak!`) that reads as nil once its object is freed, promoted to a strong local when read.
- `weak var p: Node?` locals. How they break cycles through closures is in [memory management](runtime.md#memory-management).

## Equality

- User-defined `equals` and `hash`, which `==` and maps use. A class that defines `equals` is `Hashable` only if it also defines `hash` (preventing the mistake of equal values with different hashes).

## Open questions

- Whether an extend should be in effect beyond the modules that import its module directly.
- Whether an interface may declare a writable member (`var count: Int`, satisfied only by a class's `var` field). Its members are read-only for now (see [the reference](../reference/objects.md#interfaces) for why); reconsider if that proves limiting.
- How to handle conversion from an interface value to another interface (the concrete type is unknown until run time, so a static itab is not enough; forbid it or generate at run time).
