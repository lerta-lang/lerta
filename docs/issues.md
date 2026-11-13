# Issues

Known defects. Each says where it is, how to see it and how to fix it. An issue marked *unverified* was found by reading the code and has not been reproduced.

## The layout joins a block whose items take lines

`lerta fmt` reports `its rewrites would not parse ... which is a fault of the formatter` for some arrays written as blocks where an item takes lines of its own, as a function body after its arguments or arguments in a block below their call:

```lerta
checks: Check[] =
  Check(name: 'one', run: ->
    1
  )
  Check(name: 'two', run: -> 2)
```

The layout writes the items on one line in brackets, `[Check(name: 'one', run: ->` and so on, which does not parse; but not always, as a block of three items whose second takes lines stays. *Unverified:* the layout seems to take the items for ones that fit on a line by their widths. Fix: keep a block whose items take lines a block, or lay it out in brackets with an item on each line.

## A default cannot read the names of a parameter taken apart

A parameter taken apart declares its names at the start of the body, after the defaults are computed, so a later default cannot read them, and the message names the wrong problem:

```lerta
f := ((a, b): (Int, Int), y = a) -> y
```

reports `the type of the parameter 'y' must be written`. The fix is to declare the names before the defaults (see parse_destructured_parameter and generate_default_entry), or to say that the name is not in scope there.
