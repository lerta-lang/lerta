# Objects

The planned design of classes and structs, interfaces, generics and equality.

## Classes and structs

- Structs copied inline when they are small, and shared via RC when they are large.
- A function literal member declared `var`, `var on_hover = -> log 'hover'`, is a function field held per instance, so that it can be replaced (class only). A `const` one (the default) is a method. The difference in representation follows from whether reassignment is allowed.
- Constructing a class or struct, `Circle(r: 1)`, is also a call to a constructor that takes an anonymous struct with the type-only fields.
- Definite assignment analysis in place of the rule for field initializers, which may read only the fields set before them through `@` ([the reference](../reference/objects.md#members)): `@` still cannot leak before all the fields are initialized, but an initializer may use it otherwise, as by calling a method that reads only those fields.
- Classes, structs, enums and type aliases declared inside a function, visible in its scope. Their methods and initializers do not see the function's locals, so that a type does not become a closure; `export`, `import`, `extend` and `extern` stay at the top level, where a module's names and the reach of its extends are decided.

## Interfaces

What is implemented, interfaces as bounds and as types of values, is in [the reference](../reference/objects.md#interfaces). Planned:

- Values of `Int`, `Bool`, `Byte` and enums in interface values, which are not references: the itab then tells whether the data is one.

## Generics

- The body of a generic function or method is **checked at definition** against its bounds, instead of per instance (avoiding the C++ template "error deep inside").
  - A type parameter is then a type of its own that has the members of its bounds alone: operators, `==`, ordering and interpolation apply to it through the builtin interfaces that already give them (`Add`, `Equatable`, `Comparable`, `Stringable` and the like), with no new kind of bound. `x * 2` for both `Int` and `Float`, which `Mul` cannot say, is left out.
  - A call checks that the type arguments satisfy the bounds and records which member satisfies each bound's member (the witnesses, as an itab's entries are found). An instance is the type arguments with those witnesses, which replace telling instances apart by the extends that the call sees.
  - An instance is no longer checked: its facts are the generic's with the type arguments put in and the bounds' members resolved by the witnesses, which codegen generates as it does now. A default is still checked for the instance of a call that leaves it out, and a type that the body writes is still checked to be valid for the type arguments, as `Set<T>` for a `T` without hash.
  - It shortens nothing: what goes (the per-instance checking, the variants by extends) is less than what comes (members through bounds, instances from the generic's facts). It is for the errors at the definition, the checking of bodies never called, and `lerta fmt` and the editor inside generic bodies.
  - In steps that each keep the tests passing, with no new syntax and so no refresh of the seed: check the bodies at definition besides per instance, giving the bodies that use what no bound gives (`T[]`'s `contains`, by `==`) the bounds they need; then instances by witnesses; then instances from the generic's facts in place of checking them.
- Generic function literals outside the top level.
- Bounds on the type parameters of generic classes and structs, `class Sorted<T: Comparable>`, checked wherever the type is written.

## Equality

- `==` on interface values, and interface values as `Map` keys, by the equality of the values they hold.

## Open questions

- With generic bodies checked at definition ([generics](#generics)): whether an optional type argument stays allowed, which a type that the body writes may not take, as a `Set<T>`'s key; whether bounds on the type parameters of generic classes and structs come first, so that their bodies are checked at definition too; and whether a `Numeric` bound, under which a number literal is a `T`, is worth a new implicit conversion. It would also settle `sum` of [Iterables](../reference/types.md#iter), whose default `zero` of `0` is an error for a `String[]` now, `sum()` failing to compile where `sum('')` is needed.
- Whether an extend should be in effect beyond the modules that import its module directly.
- Whether a class or struct may name several interfaces it satisfies (`struct S: A, B`), and what it does when two give a field of the same name.
- Whether an interface may declare a writable member (`var count: Int`, satisfied only by a class's `var` field). Its members are read-only for now (see [the reference](../reference/objects.md#interfaces) for why); reconsider if that proves limiting.
- How to handle conversion from an interface value to another interface (the concrete type is unknown until run time, so a static itab is not enough; forbid it or generate at run time).
- Whether a class's fields are `const` by default, as a struct's are and as Kotlin's `val` and Swift's `let` are written first, with `var` for those that are assigned. Most fields are never assigned after construction, but are `var` now, so a test on them cannot narrow them ([narrowing](../reference/control-flow.md#narrowing)).
- Whether a class or struct body declares its members with `:=`, as a const is declared elsewhere (`count := 0`, `area := -> @w * @h`), rather than with `name = value`, which reads as an assignment although none can be written there. With the fields of a class `const` by default (above), the body would then need no `const`, which would leave the language without the word.
- Whether a class or struct may keep members from the code outside its module, as a module keeps its names that it does not export. The state of std's own classes, as a `Reader`'s `chunk`, `start` and `reading` or a `Server`'s `waiting`, can be assigned by any program now, which breaks what their methods rely on.
