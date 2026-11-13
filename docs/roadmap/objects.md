# Objects

The planned design of classes and structs, interfaces, generics and equality.

## Classes and structs

- Small structs as values, large ones still shared by reference counting: see [small values unboxed](language.md#types).
- **Function fields.** A function literal member declared `var`, `var on_hover = -> log 'hover'`, is a function field held per instance, so that it can be replaced (class only). One declared with `:=` stays a method. The difference in representation follows from whether reassignment is allowed.
- **Constructors as functions.** Constructing a class or struct, `Circle(r: 1)`, is also a call to a constructor that takes an anonymous struct with the type-only fields.
- **Definite assignment.** Definite assignment analysis replaces the rule that an initializer may read only the fields set before it through `@` ([the reference](../reference/objects.md#members)). `@` still cannot leak before all the fields are initialized, but an initializer may use it otherwise, as by calling a method that reads only those fields.
- **Static members,** called on the type, as `Date.parse(text)`.
  - Why: a function made for a type is found by the type, as std:json finds `from_json` (see [programs](programs.md#standard-library)).
  - An interface may have them, as `from_json: static (J) -> Self`, which only bounds type parameters, as `Self` does.
  - They replace the rule that functions related to a type are module functions ([the reference](../reference/objects.md#members)).
  - A type cannot have a static member and a field or method of the same name, so that `Type.name` names one: a method or a field named by its type is already a function value (see [functions as values](../reference/functions.md#functions-as-values)).
- **Local types.** Classes, structs, enums and type aliases declared inside a function, visible in its scope.
  - Their methods and initializers do not see the function's locals, so that a type does not become a closure.
  - `export`, `import`, `extend` and `extern` stay at the top level, where a module's names and the reach of its extends are decided.

## Interfaces

What is implemented, interfaces as bounds and as types of values, is in [the reference](../reference/objects.md#interfaces). Planned:

- Values of `Int`, `Float`, `Bool`, `Byte` and enums in interface values, which are not references: the itab then tells whether the data is one.

## Equality

- `==` on interface values, and interface values as `Map` keys, by the equality of the values they hold.

## Open questions

- With generic bodies checked at definition (see [generic functions](../reference/functions.md#generic-functions)):
  - whether an optional type argument stays allowed, which a type that the body writes may not take, as a `Set<T>`'s key;
  - whether a `Numeric` bound, under which a number literal is a `T`, is worth a new implicit conversion. It would also settle `sum` of [Iterables](../reference/types.md#iter), whose default `zero` of `0` is an error for a `String[]` now: `sum()` fails to compile where `sum('')` is needed.
- Whether an extend should be in effect beyond the modules that import its module directly.
- Whether a class or struct may name several interfaces it satisfies (`struct S: A, B`), and what it does when two give a field of the same name.
- Whether an interface may declare a writable member (`var count: Int`, satisfied only by a class's `var` field). Its members are read-only for now (see [the reference](../reference/objects.md#interfaces) for why); reconsider if that proves limiting.
- How to convert an interface value to another interface. The concrete type is unknown until run time, so a static itab is not enough: forbid it, or generate one at run time.
- Whether a class or struct may keep members from the code outside its module, as a module keeps the names it does not export. Now any program can assign the state of std's own classes, as a `Reader`'s `chunk`, `start` and `reading` or a `Server`'s `waiting`, which breaks what their methods rely on.
