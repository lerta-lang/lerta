# Issues

Known defects. Each says where it is, how to see it and how to fix it. An issue marked *unverified* was found by reading the code and has not been reproduced.

## Hover gives nothing on a parameter at its declaration

`lerta lsp` gives no type and no definition for a parameter's name where it is declared, as `f` in `map := (f: (Int) -> Int) -> f(@item)`, though it gives them for `f` in the body. The checker records no type for the declaring name, which candidates_at in compiler/lsp/locate.lerta finds through the facts' types alone. The fix is to record the parameters' names too, or to let the LSP find them through the function's type.
