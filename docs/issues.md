# Issues

Known defects. Each says where it is, how to see it and how to fix it. An issue marked *unverified* was found by reading the code and has not been reproduced.

## An array cannot hold optional interface values

`is_reference_type` (`compiler/types.lerta`) is false for an `InterfaceType`, so `check_item_type` (`compiler/checker/collection.lerta`) rejects arrays of optional interface values, although an interface value is a reference. `xs: Named?[] = [nil]`, with `interface Named` of a field `name: String`, fails with `an array cannot hold values of type Named?`. Fix: count interface types as references there, and drop interfaces from the limitation in [optional values](reference/types.md#optional-values).
