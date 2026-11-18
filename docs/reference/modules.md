# Modules

```lerta
import read_file, stdout from 'std:io'
import argv, exit from 'std:process'
```

- A file is a module.
- Imports are written at the top level.
- Why: ESM style, so there is no `import *` and no `export default` (see [philosophy](../philosophy.md#non-goals)).

### Module names

| Name | Module |
|---|---|
| `'std:<name>'` | a [standard module](std.md) |
| `'std:builtins'` | the module of the [builtins](builtins.md) |
| `'./<path>'`, `'../<path>'` | another file, relative to the importing one, without the `.lerta` extension: `import Point from './lib/geometry'` |

- A directory has no `index` resolution.
- Other names are reserved.

### Import forms

| Form | Makes available |
|---|---|
| `import a, b from 'module'` | the named exports, functions and methods included, in the whole module |
| `import a as c from 'module'` | `a` as `c` |
| `import 'module'` | no name, so it never warns: it only makes the module's [top-level code](#top-level-code-and-cycles) run, and brings its [extends](objects.md#extend), as any import of it does |
| `import 'module' as mod` | its exports as `mod.<export>` |
| `import './file' as NAME: Binary` | the file's contents as a `const` (see [embedded files](#embedded-files)) |

### Imports by name

- `as` lets two modules' exports of the same name be imported together. One export may be imported under several names. `as` is not a keyword.
- A type or a value may be imported under the name of a builtin, which it then shadows, as a declaration does (see [shadowing](control-flow.md#shadowing)).
- The names are separated by commas, and the last one, which no comma follows, by `from`, so `from` itself can be imported.
- An imported name that is never used is a warning (see [unused names](errors.md#unused-names)).
- The names may also be an indented block on the lines below `import`, separated as the items of a [bracketless block](syntax.md#bracketless-blocks), with `from 'module'` on the line after it:
  ```lerta
  import
    ArrayLiteral, Assignment, BinaryOperation, Call, Conditional, FunctionLiteral, Identifier,
    Await as wait
  from './ast'
  ```

### Qualified imports

- `import 'module' as mod` gives its exports as `mod.<export>`, alongside any names imported from it by name:
  - in values: `mod.distance(p, q)`, `mod.ORIGIN`, `mod.Point(x: 1, y: 2)`, `mod.Color.RED`;
  - in types: `p: mod.Point`, `<T: mod.Shaped>`.
- `mod` itself is no value: `'mod' is a module, which is no value: write mod.<export>`.
- A local of the name hides it in values, as it hides any other name, though not in types, whose names are apart from those of values.
- An export the module does not have is an error where `mod.<export>` names it.
- An unused `mod` warns as an unused name does.
- This is not the `import *` that [philosophy](../philosophy.md#non-goals) leaves out, which would bring the names in unqualified.

### Embedded files

```lerta
import './tables/letters.bin' as LETTERS: Binary
import './notice.txt' as NOTICE: String
```

- An import with a type after its name embeds the file in the program: the name is a top-level `const` of its contents, read as the program is compiled, which the program holds as a literal.
- The type is `Binary` or `String`. A `String`'s file must be valid UTF-8.
- The path starts with `./` or `../`, relative to the importing file, as a module's, but it is the file's whole name: no `.lerta` is added.
- `export './file' as NAME: Binary` embeds the file and exports the name, as `export` before the `const` would.
- An unused name warns as an unused `const` does.

## Exports

```lerta
export struct Point
  x: Int
  y: Int

export struct Circle
  center: Point
  radius: Int

export type Shape = Point | Circle

export origin := -> Point(x: 0, y: 0)
export unit := 1
```

- `export` before a top-level `const` (a function or a value), class, struct, enum, interface or type alias makes it importable.
- An imported value cannot be assigned, and is narrowed as a `const` is (see [narrowing](control-flow.md#narrowing)).
- An exported value is not warned about if its module does not use it (see [unused names](errors.md#unused-names)).
- Names are local to their module: other names cannot be imported, and different modules may use the same name.
- Classes, structs and enums of the same name in different modules are different types. Where a message would not tell them apart, it names their modules.

### Re-exports

- `export a, b as c from 'module'` exports names of another module as this module's own, under their aliases if they have them, in a line or in an indented block as an import's names.
  - The importers get the declarations themselves, so a type is the same through either module.
  - The names are not imported into this module, which imports them apart if it uses them.
  - It is an error to name a name the module does not export, to export a name twice, or for modules to export a name from each other.
- `export 'module'` exports no name.
- Both bring the module's extends, as an import does, and pass them on: an extend is also in effect in the modules that import one that exports from its module, by any export, and so on through modules that export from those.
- `export` of names or of a module is at the top level, and takes no `as name` of the module, except to [embed a file](#embedded-files).

## Top-level code and cycles

### Order

- A program runs the top-level code of its entry module from top to bottom; there is no `main`.
- Before it, that of every module it imports, directly or not, runs once, each after the modules it imports, except those that import it back.
- A module's top-level code that [awaits](functions.md#functions-that-await) is done only once it has stopped waiting.
- At the end of the program, the top-level values are released in the reverse order of their initialization, so that a `deinit` that runs then can still use those initialized before.
- Each is uninitialized again as it is released, so reading one already released, own or imported, throws an `InitError`. Some `const`s are never released (see [top-level values](functions.md#top-level-values)).

### Cycles

- Imports can be circular. The top-level code of a cycle of modules runs as that of one module would: that of its members one after another, in the order above. So in a cycle that the entry module enters at `a`, where `a` imports `b` and `b` imports `a`, `b` runs first.
- Within the cycle, the rules of one module's [top-level values](functions.md#top-level-values) carry over: functions can be used in any order, an inferred type is worked out where it is needed, and a value read through a function before it is initialized throws.
- The top-level code of a module cannot read a value of a module of its cycle that runs after it, as the value's type is not known yet. Nor can it call a function whose return type is inferred, or construct an object whose field type is inferred, that reads such a value.
- Functions whose return types are inferred cannot call each other across modules either: `'f' is recursive, so its return type must be written`.
- Type aliases cannot refer to each other in a cycle across modules, as within one.
- A cycle does not widen where an [extend](objects.md#extend) is in effect.
