# Modules

```
import read_file, stdout from 'std:io'
import argv, exit from 'std:process'
```

- A file is a module. `import a, b from 'module'` makes the named exports of a module available in the whole module, functions and methods included. `import a as c from 'module'` makes `a` available as `c`, so that two modules' exports of the same name can be imported together; one export may be imported under several names. A type or a value may be imported under the name of a builtin, which it then shadows, as a declaration does (see [control flow](control-flow.md)). `as` is not a keyword. The names are separated by commas, and the last one, which no comma follows, by `from`, so `from` itself can be imported. Imports are written at the top level. An imported name that is never used is a warning (see [unused names](errors.md#unused-names)).
- The names may also be an indented block on the lines below `import`, separated as the items of a [bracketless block](syntax.md#bracketless-blocks), with `from 'module'` on the line after it:
  ```
  import
    ArrayLiteral, Assignment, BinaryOperation, Call, Conditional, FunctionLiteral, Identifier,
    Await as wait
  from './ast'
  ```
- `import 'module'` imports no name, and so never warns: it only makes the module's [top-level code](#top-level-code-and-cycles) run, and brings its extends (see [objects](objects.md#extend)), as any import of it does.
- `import 'module' as mod` gives its exports as `mod.<export>`, in values (`mod.distance(p, q)`, `mod.ORIGIN`, `mod.Point(x: 1, y: 2)`, `mod.Color.RED`) and in types (`p: mod.Point`, `<T: mod.Shaped>`), alongside any names imported from it by name. `mod` itself is no value (`'mod' is a module, which is no value: write mod.<export>`), and a local of the name hides it in values, as it hides any other name, though not in types, whose names are apart from those of values. An export the module does not have is an error where `mod.<export>` names it, and an unused `mod` warns as an unused name does. This is not the `import *` that [philosophy](../philosophy.md#non-goals) leaves out, which would bring the names in unqualified.
- `'std:<name>'` is a [standard module](std.md), and `'std:builtins'` the module of the [builtins](builtins.md). A path that starts with `./` or `../` names another file, relative to the importing one, without the `.lerta` extension: `import Point from './lib/geometry'`. Other names are reserved.
- Why: ESM style, so there is no `import *` and no `export default` (see [philosophy](../philosophy.md#non-goals)). Paths need `./` or `../` and have no `index` resolution for directories. Functions can be declared in any order (see [top-level values](functions.md#top-level-values)).

## Exports

```
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

- `export` before a top-level `const` (a function or a value), class, struct, enum, interface or type alias makes it importable. An imported value cannot be assigned, and is narrowed as a `const` is (see [control flow](control-flow.md#if-and-while)). An exported value is not warned about if its module does not use it (see [unused names](errors.md#unused-names)). Names are local to their module: other names cannot be imported, and different modules may use the same name. Classes, structs and enums of the same name in different modules are different types; where a message would not tell them apart, it names their modules.
- `export a, b as c from 'module'` exports names of another module as this module's own, under their aliases if they have them, in a line or in an indented block as an import's names; the importers get the declarations themselves, so that a type is the same through either module. The names are not imported into this module, which imports them apart if it uses them. A name the module does not export is an error, as are a name exported twice and modules that export a name from each other. `export 'module'` exports no name. Both bring the module's extends, as an import does, and pass them on: an extend is also in effect in the modules that import one that exports from its module, by any export, and so on through modules that export from those. `export` of names or of a module is at the top level, and takes no `as name` of the module.

## Top-level code and cycles

- A program runs the top-level code of its entry module from top to bottom; there is no `main`. Before it, that of every module it imports, directly or not, runs once, each after the modules it imports, except those that import it back; a module's top-level code that [awaits](functions.md#functions-that-await) is done only once it has stopped waiting. At the end of the program, the top-level values are released in the reverse order of their initialization, so that a `deinit` that runs then can still use those initialized before. Each is uninitialized again as it is released, so reading one already released, own or imported, throws an `InitError` (see [top-level values](functions.md#top-level-values)).
- Imports can be circular. The top-level code of a cycle of modules runs as that of one module would: that of its members one after another, in the order above, so in a cycle that the entry module enters at `a`, where `a` imports `b` and `b` imports `a`, `b` runs first. Within the cycle, the rules of one module's top-level values carry over (see [top-level values](functions.md#top-level-values)): functions can be used in any order, an inferred type is worked out where it is needed, and a value read through a function before it is initialized throws. The top-level code of a module cannot read a value of a module of its cycle that runs after it, nor call a function whose return type is inferred, or construct an object whose field type is inferred, that does: the value's type is not known yet. Functions whose return types are inferred cannot call each other across modules either (`'f' is recursive, so its return type must be written`). Type aliases cannot refer to each other in a cycle across modules, as within one. A cycle does not widen where an extend is in effect (see [objects](objects.md#extend)).
