# Issues

Known defects. Each says where it is, how to see it and how to fix it. An issue marked *unverified* was found by reading the code and has not been reproduced.

## An array cannot hold optional interface values

`check_item_type` (`compiler/checker/collection.lerta`) rejects arrays of optional interface values, as the generated code would hold them as optional values that are not references (`is_optional_value` in `compiler/codegen/array.lerta`), whose `{ i1, T }` an interface value's two pointers are not. `xs: Named?[] = [nil]`, with `interface Named` of a field `name: String`, fails with `an array cannot hold values of type Named?`. Fix: hold them as interface items, a null data pointer for nil, and drop the limitation in [optional values](reference/types.md#optional-values).

## fmt breaks an operation only after its outermost operator

Where an operation does not fit, `value_after` (`compiler/format/print_literal.lerta`) breaks it only after the operators of the outermost operation (`operation_start` in `compiler/format/print_operation.lerta`), never inside an operand. So `total := a +` over `b * c *` and `d`, with names long enough that `b * c * d` takes 102 columns, is reported under [Line length](reference/style.md#line-length) at the `*` that ends a line, and `--fix` joins `b * c * d` into one line of 102 columns, which it then reports again. Fix: break an operand that is itself an operation after its own operators when its line does not fit.

## fmt puts a call's arguments in parentheses for a comment inside one

Where a call's arguments are in a block and the value of one starts after a comment, `call_doc` (`compiler/format/print_expression.lerta`) writes them in parentheses. The comment makes the value's doc hold a line feed, and `bracketed_or` (`compiler/format/printing.lerta`) takes a block before the last item for a list to break after its `(`. `x := label`, over `text:`, a comment and `first + ' then'` one level deeper, and `size: 'a'`, is rewritten to `x := label(`…`)`, where the style keeps the block. Fix: let the block of arguments hold items that end their line, as it does a comment before an argument.

## fmt writes a `case` inside a call's parentheses

A call whose arguments fit on its line but for a `case`, as `x := label` over `text: 'a'` and `size: case n` with its arms, is rewritten to `x := label(text: 'a', size: case n`, the arms one level deeper and `)` on a line of its own, reported under Branches. The arms then hang from inside the parentheses, which [Branches](reference/style.md#branches) does not allow: a `case` starts a line of its own. `bracketed_or` (`compiler/format/printing.lerta`) keeps the arguments on the line of the call when the last one alone breaks. Fix: write the arguments in a block when one of them is an `if`, a `case` or a `try` that takes lines below.

## lerta_status_fields gives a result that nothing needs

`lerta_status_fields` (`runtime/file.c`) gives `false` where the status cannot be read, but its extern in `std/io.lerta` is declared `void`, and `stat` gives nil from an empty `fields` either way. It cannot become `void` in the runtime before a seed refresh, as the seed is compiled from a std that declared it to give `Bool`, which reads a result that the runtime would then not give: `is_file` of the seed's minilerta gives false. Fix: once the seed is refreshed, make it `void` in `runtime/file.c` and `runtime/lerta.h`.

## The compiler does not carry the license notices

[Cache](reference/compiler.md#cache) says that an executable given to others goes with Lerta's license notice and libuv's, but the compiler holds neither text: `build/embedded.lerta` (see [embedded files](internals/architecture.md#embedded-files)) embeds only `std/`, `runtime/` and libuv's sources. One who has only the compiler, as from a binary release, has no copy of `LICENSE-MIT`, `LICENSE-APACHE` or `third_party/libuv/LICENSE` to give. Fix: embed them and add a command that writes them out.
