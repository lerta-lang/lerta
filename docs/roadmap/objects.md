# Objects

The planned design of classes and structs, interfaces, generics and equality.

## Classes and structs

- Structs copied inline when they are small, and shared via RC when they are large.
- A function literal member declared `var`, `var on_hover = -> log 'hover'`, is a function field held per instance, so that it can be replaced (class only). One declared with `:=` is a method. The difference in representation follows from whether reassignment is allowed.
- Constructing a class or struct, `Circle(r: 1)`, is also a call to a constructor that takes an anonymous struct with the type-only fields.
- Definite assignment analysis in place of the rule for field initializers, which may read only the fields set before them through `@` ([the reference](../reference/objects.md#members)): `@` still cannot leak before all the fields are initialized, but an initializer may use it otherwise, as by calling a method that reads only those fields.
- Static members, called on the type, as `Date.parse(text)`, so that a function made for a type is found by the type, as std:json finds `from_json` (see [programs](programs.md#standard-library)). An interface may have them, as `from_json: static (J) -> Self`, which only bounds type parameters, as `Self` does. Enum's builtin `parse` becomes one. They replace the rule that functions related to a type are module functions ([the reference](../reference/objects.md#members)).
- Classes, structs, enums and type aliases declared inside a function, visible in its scope. Their methods and initializers do not see the function's locals, so that a type does not become a closure; `export`, `import`, `extend` and `extern` stay at the top level, where a module's names and the reach of its extends are decided.

## Interfaces

What is implemented, interfaces as bounds and as types of values, is in [the reference](../reference/objects.md#interfaces). Planned:

- Values of `Int`, `Bool`, `Byte` and enums in interface values, which are not references: the itab then tells whether the data is one.

## Equality

- `==` on interface values, and interface values as `Map` keys, by the equality of the values they hold.

## Open questions

- With generic bodies checked at definition (see [generic functions](../reference/functions.md#generic-functions)): whether an optional type argument stays allowed, which a type that the body writes may not take, as a `Set<T>`'s key; and whether a `Numeric` bound, under which a number literal is a `T`, is worth a new implicit conversion. It would also settle `sum` of [Iterables](../reference/types.md#iter), whose default `zero` of `0` is an error for a `String[]` now, `sum()` failing to compile where `sum('')` is needed.
- Whether an extend should be in effect beyond the modules that import its module directly.
- Whether a class or struct may name several interfaces it satisfies (`struct S: A, B`), and what it does when two give a field of the same name.
- Whether an interface may declare a writable member (`var count: Int`, satisfied only by a class's `var` field). Its members are read-only for now (see [the reference](../reference/objects.md#interfaces) for why); reconsider if that proves limiting.
- How to handle conversion from an interface value to another interface (the concrete type is unknown until run time, so a static itab is not enough; forbid it or generate at run time).
- Whether a class or struct may keep members from the code outside its module, as a module keeps its names that it does not export. The state of std's own classes, as a `Reader`'s `chunk`, `start` and `reading` or a `Server`'s `waiting`, can be assigned by any program now, which breaks what their methods rely on.
