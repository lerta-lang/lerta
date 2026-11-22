# Basics

## Hello

```lerta
print 'hello, world'
```

```output
hello, world
```

A program is a file of statements, run from the top. `print` is called without parentheses, as a call at the start of a statement may be.

## Names

```lerta
limit := 3
var count = 0
count += limit
print count
```

```output
3
```

`:=` declares a name that is never reassigned, the most common kind, and `var` one that is. The types come from the values: `limit` and `count` are `Int`s.

A type may be written after the name, where the value does not determine it:

```lerta
ratio: Float = 1
var found: String?
print ratio
print found else 'not found'
```

```output
1.0
not found
```

`found` is a `String?`, a string or nil, and starts as nil. It cannot be printed as it is, since it may be nil: `else` gives the value to use for nil (see [optional values](optional-values.md)).

## Strings

```lerta
name := 'Lerta'
version := 1
print "#{name} #{version}: #{name.count()} letters, #{name.to_upper()}"
```

```output
Lerta 1: 5 letters, LERTA
```

`'...'` is a plain string, and `"..."` one that interpolates `#{...}`.

## Comments

```lerta
# A comment runs to the end of its line.
print 1 + 2  # and may follow code
```

```output
3
```

## Indentation

Blocks are indented, by two spaces, with no braces and no `end`. [`lerta fmt`](../reference/compiler.md#fmt) lays out every program the same way, so all Lerta code looks alike.

For the rules, see [syntax](../reference/syntax.md) and [types](../reference/types.md).
