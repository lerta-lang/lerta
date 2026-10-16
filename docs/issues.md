# Known issues

Defects of what is implemented: where the implementation departs from [the reference](reference/README.md) or [the internals](internals.md), or fails without a cause in the program. Each is removed when it is fixed. What is not implemented yet is in [the roadmap](roadmap/README.md).

Each entry says what goes wrong, a minimal program that shows it, and where the cause is. An entry marked *unconfirmed* was found by reading the code and has not been reproduced.

## Compiler

### Instances that each make two larger ones hang the compiler

```
class A<T>
  a = Map<String, A<T[]>>()
  b = Map<String, A<Map<String, T>>>()
print A<Int>().a.length
```

The compiler never ends, and so does a generic function that calls two instances of deeper type arguments, as `f<T>` calling `f<T[]>` and `f<Map<String, T>>`. The depth that stops a chain of ever deeper instances (`MAX_TYPE_DEPTH` in `compiler/checker/generics.lerta`) is reached only after a number of instances exponential in it. Limiting the number of instances as well, or finding the growth from the generic declaration once, would cover it.
