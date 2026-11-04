# Issues

Known defects. Each says where it is, how to see it and how to fix it. An issue marked *unverified* was found by reading the code and has not been reproduced.

## An array cannot hold optional interface values

`is_reference_type` (`compiler/types.lerta`) is false for an `InterfaceType`, so `check_item_type` (`compiler/checker/collection.lerta`) rejects arrays of optional interface values, although an interface value is a reference. `xs: Named?[] = [nil]`, with `interface Named` of a field `name: String`, fails with `an array cannot hold values of type Named?`. Fix: count interface types as references there, and drop interfaces from the limitation in [optional values](reference/types.md#optional-values).

## fmt adds brackets to a literal under a field of a block

`named_item` (`compiler/format/print_literal.lerta`) prints a field's value with `spaced_value`, not `value_after`, so a literal under `key:` in a bracketless block never goes in a block of its own, against [Multi-line literals](reference/style.md#multi-line-literals). In `config :=`, with `name: 'lerta'` and `targets:` over a block of five long strings, one per line, `lerta fmt` reports `write the literal in a block without brackets (Multi-line literals)` at `targets:`, which is already without brackets, and `--fix` writes `targets: [`…`]`. Fix: print a field's value through `value_after` where the record is printed as a block.

## fmt breaks an operation only after its outermost operator

Where an operation does not fit, `value_after` (`compiler/format/print_literal.lerta`) breaks it only after the operators of the outermost operation (`operation_start` in `compiler/format/print_operation.lerta`), never inside an operand. So `total := a +` over `b * c *` and `d`, with names long enough that `b * c * d` takes 102 columns, is reported under [Line length](reference/style.md#line-length) at the `*` that ends a line, and `--fix` joins `b * c * d` into one line of 102 columns, which it then reports again. Fix: break an operand that is itself an operation after its own operators when its line does not fit.
