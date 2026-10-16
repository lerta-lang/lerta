# Known issues

Defects of what is implemented: where the implementation departs from [the reference](reference/README.md) or [the internals](internals.md), or fails without a cause in the program. Each is removed when it is fixed. What is not implemented yet is in [the roadmap](roadmap/README.md).

Each entry says what goes wrong, a minimal program that shows it, and where the cause is. An entry marked *unconfirmed* was found by reading the code and has not been reproduced.

## Compiler

### Two generic classes that hold larger instances of each other hang the compiler

```
class A<T>
  b: B<A<T>>? = nil
class B<T>
  a: A<B<T>>? = nil
const x: A<Int>? = nil
```

The compiler never ends: the instances of the classes it makes grow without end. A class that holds a larger instance of itself is rejected where it is written (`reject_larger_self` in `compiler/checker/object_types.lerta`), but that looks at one declaration only. Checking each generic declaration once for what its type parameters must be, across the declarations it names, rather than each instance's fields, would cover this, and would also give the check of interface instances (`compiler/checker/type_validity.lerta`) the errors it skips for an instance nested in one of the same interface.

