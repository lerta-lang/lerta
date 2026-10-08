# Classes, structs and interfaces

Classes and structs with fields, initializers, methods, `init`, `deinit` and named construction are implemented: see [the reference](../reference/objects.md). Planned beyond that: `weak`, replaceable (`var`) function fields, `equals` and `hash` (classes compare by identity already), and interfaces.

- There are no static members (`static`). Functions related to a type are module functions (`import rgb from './rgb'` → `rgb.parse(s)`; the module is the namespace). Methods can be added to an existing type by `extend` (see [the reference](../reference/objects.md#extend)), but not functions without a receiver.

## Type body (shared by class and struct)

```
class Button
  const id: Int                  # field that cannot be changed after construction (class fields default to var)
  label: String                  # type only → named constructor argument (required)
  weak parent: Button?           # a nilable field may be omitted (defaults to nil)
  on_click: () -> void           # type only, so a field even though it is a function
  count = 0                      # initializer → field computed at construction
  items: Array<String> = []      # an initializer with a type annotation is also a field
  var on_hover = -> log 'hover'  # function literal with var → replaceable function field (class only)
  click = -> @count += 1         # function literal → method
  init = -> log 'created'        # no parameters; runs at the end of construction
  deinit = -> log 'bye'          # class only

const b = Button(label: 'OK', on_click: -> log 'hi')
```

- A function literal member is a method, one per type, with `@` passed at call time, when `const` (the default). When `var`, it is a function field held per instance so it can be replaced (class only). The difference in representation follows necessarily from whether reassignment is allowed. Not everything is a function field, because closures capturing `@` would create a cycle in every object.

## Differences between class and struct

|  | `class` | `struct` |
|---|---|---|
| Default `==` | Pointer comparison | Field-by-field comparison |
| Default `hash` | Address | Computed from fields (automatic if all fields are `Hashable`) |
| `weak` references | Allowed | Not allowed |
| Cycles | Possible | Impossible |

```
struct Circle
  r: Float
  area = @r * @r * PI
  scaled = (k: Float) -> Circle(r: @r * k)
  init = ->
    throw RangeError('r < 0') if @r < 0

Circle(r: 1) == Circle(r: 1)   # true
```

- A struct is immutable, so copying and sharing cannot be told apart from outside. The implementation may choose either (see [internals](../internals.md#structs-planned)).
- A struct has no `deinit` and no `weak` because if the time of release were observable, the freedom above would be lost. The use of weak (breaking cycles) is not needed for structs either.
- Rules for `deinit`: it does not throw (failures are swallowed; to handle errors, call `close()` explicitly), it is synchronous only (no `await`), and it does nothing but cleanup (beware of reentrancy).

## Anonymous structs

Anonymous struct literals and types, the `{ x, y }` shorthand, destructuring and leaving out `{}` for a last argument are implemented: see [the reference](../reference/types.md#anonymous-structs). Planned:

- Constructing a class or struct, `Circle(r: 1)`, is also a call to a constructor that takes an anonymous struct with the type-only fields.

## Map literals

Implemented: see [the reference](../reference/types.md#map).

## interface

- A structural type of behavior. It may have default implementations (replacing code reuse through inheritance).
- It may also declare fields (`x: Int`). A class or struct with a field of the same name and type satisfies it structurally.
  - Fields accessed through an interface are **read-only** (write through the concrete type). There are no getters.
  - A field common to every member of a union can already be read without an interface (see [unions](../reference/types.md#unions)).
- A method `area(): Float` can also be satisfied by a function-valued field of the same type (`{ area: -> 3.0 }`).

## Equality

- `==` is `equals`.
- A class that does not define `equals` is implicitly `Equatable` and `Hashable` by identity: implemented, see [the reference](../reference/objects.md#classes-and-structs).
- A class that defines `equals` is `Hashable` only if it also defines `hash` (preventing the mistake of equal values with different hashes).
