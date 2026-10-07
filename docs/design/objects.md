# Classes, structs and interfaces

- **No inheritance** (`extends`/`super` do not exist).
- There are no static members (`static`). Functions related to a type are module functions (`import rgb from './rgb'` → `rgb.parse(s)`; the module is the namespace).

## Type body (shared by class and struct)

Members of a class and a struct are written the same way. The only difference is the keyword.

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

- `@x` is `this.x`. `@` alone is `this`.
- With `=` it is a field with an initializer. Without it, it is a constructor argument (a type annotation does not matter).
- Construction is always named: `Button(label: ...)` (there is no `new` and no positional form). In order: (1) the arguments are assigned to the type-only fields, (2) the initializer fields are computed in declaration order (earlier fields can be referenced with `@`), (3) `init` runs if present.
  - Initializer fields cannot be overridden by the constructor (computed fields are not broken from outside).
- A method exists once per type, and `this` is passed at call time. Not everything is a function field, because closures capturing `this` would create a cycle in every object.
- `const` / `var` mean the same as in [syntax.md](syntax.md#declarations) (whether reassignment is allowed). When omitted, methods default to `const` and fields to `var` (in a struct everything is `const`, and `var` cannot be written).
  - A function literal member is a method, one per type, when `const` (the default). When `var`, it is a function field held per instance so it can be replaced. The difference in representation follows necessarily from whether reassignment is allowed.
- A type-only field is a required argument. But if it is nilable (`T?`) it may be omitted, and defaults to nil.

## Differences between class and struct

|  | `class` | `struct` |
|---|---|---|
| Fields | Mutable by default (`const` makes them immutable) | Immutable |
| Role of `init` | Continues initialization (may assign `var` fields) | Validation only (no assignment) |
| Default `==` | Pointer comparison | Field-by-field comparison |
| Default `hash` | Address | Computed from fields (automatic if all fields are `Hashable`) |
| `deinit` | Yes | No |
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

- A struct is immutable, so copying and sharing cannot be told apart from outside. The implementation may choose either (see [internals](../internals.md#structs)).
- A struct has no `deinit` and no `weak` because if the time of release were observable, the freedom above would be lost. The use of weak (breaking cycles) is not needed for structs either.
- Rules for `deinit`: it does not throw (failures are swallowed; to handle errors, call `close()` explicitly), it is synchronous only (no `await`), and it does nothing but cleanup (beware of reentrancy).

## Anonymous structs

- The literal `{ x: 0, y: 'a' }` is a value of the anonymous struct type `{ x: Int, y: String }`.
- It is structurally typed and a different type from a named struct (`Point`). Field order does not affect the type (`{ x, y }` and `{ y, x }` are the same type).
- The shorthand `{ x, y }` means `{ x: x, y: y }` (symmetric with destructuring).
- Also used for returning multiple values (there are no tuples).
- If the last argument is an anonymous struct literal, `{}` may be omitted (`draw(x: 1, y: 2)` is `draw({ x: 1, y: 2 })`). This is how named arguments are expressed.
  - Constructing a class or struct, `Circle(r: 1)`, is also a call to a constructor that takes an anonymous struct with the type-only fields.

## Map literals

- If the keys in `{}` are identifiers, it is an anonymous struct. If they are other expressions, it is a `Map`.
  ```
  { x: 0, y: 1 }            # anonymous struct
  { 'x': 0, 'y': 1 }        # Map<String, Int>
  { 1: 'one', 2: 'two' }    # Map<Int, String>
  { (k): v }                # to use a variable's value as a key, make it an expression with parentheses
  ```
- Mixing both (`{ a: 1, 'b': 2 }`) is an error. The empty Map is `Map()`.

## interface

- A structural type of behavior. It may have default implementations (replacing code reuse through inheritance).
- It may also declare fields (`x: Int`). A class or struct with a field of the same name and type satisfies it structurally.
  - Fields accessed through an interface are **read-only** (write through the concrete type). There are no getters.
- A method `area(): Float` can also be satisfied by a function-valued field of the same type (`{ area: -> 3.0 }`).

## Equality

- `==` is `equals`.
- A class that does not define `equals` is implicitly `Equatable` and `Hashable` by identity (`equals` compares pointers, `hash` comes from the address; with RC, objects do not move, so it is stable). It can be used as a `Map` key as is.
- A class that defines `equals` is `Hashable` only if it also defines `hash` (preventing the mistake of equal values with different hashes).
