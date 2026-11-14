# Issues

Known defects. Each says where it is, how to see it and how to fix it. An issue marked *unverified* was found by reading the code and has not been reproduced.

## A default cannot read the names of a parameter taken apart

A parameter taken apart declares its names at the start of the body, after the defaults are computed, so a later default cannot read them, and the message names the wrong problem:

```lerta
f := ((a, b): (Int, Int), y = a) -> y
```

reports `the type of the parameter 'y' must be written`. The fix is to declare the names before the defaults (see parse_destructured_parameter and generate_default_entry), or to say that the name is not in scope there.

## Hover gives nothing on a parameter at its declaration

`lerta lsp` gives no type and no definition for a parameter's name where it is declared, as `f` in `map := (f: (Int) -> Int) -> f(@item)`, though it gives them for `f` in the body. The checker records no type for the declaring name, which candidates_at in compiler/lsp/locate.lerta finds through the facts' types alone. The fix is to record the parameters' names too, or to let the LSP find them through the function's type.
