# Known issues

Defects of what is implemented: where the implementation departs from [the reference](reference/README.md) or [the internals](internals.md), or fails without a cause in the program. Each is removed when it is fixed. What is not implemented yet is in [the roadmap](roadmap/README.md).

Each entry says what goes wrong, a minimal program that shows it, and where the cause is. An entry marked *unconfirmed* was found by reading the code and has not been reproduced.

## Compiler

### A field whose type its initializer gives can hold a larger instance, which hangs the compiler

```
class A<T>
  b = Map<String, A<T[]>>()
print A<Int>().b.length
```

The compiler never ends: each instance's initializer makes a larger one. The instances that would grow without end are rejected by the written types of the members (`compiler/checker/growing_instances.lerta`), but a field given by its initializer alone has none, and its type is found as each instance is checked. Taking the edges from the types of the generic declaration's initializers, found once, would cover it.
