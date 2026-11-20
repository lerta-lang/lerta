# Collections

## Arrays

```lerta
xs := [3, 1, 2]
xs.push 5
print xs.length
print xs[0]
print xs.sorted()
print xs.sum()
```

```output
4
3
[1, 2, 3, 5]
11
```

`[3, 1, 2]` is an `Int[]`. An index out of range throws, rather than giving garbage or a default.

## Maps and sets

```lerta
ages := { 'ana': 31, 'bo': 25 }
ages['cy'] = 40
print ages['bo'] else 0
print ages['dan'] else 0

seen := Set(['a', 'b'])
print 'a' in seen
```

```output
25
0
true
```

`ages` is a `Map<String, Int>`. Indexing a map gives an `Int?`, nil for a missing key, so the program must say what to do then.

## for

```lerta
print "#{i}: #{name}" for name at i in ['ana', 'bo']
print "#{name} is #{age}" for (name, age) in { 'ana': 31, 'bo': 25 }
print i for i in 0..10 by 4
```

```output
0: ana
1: bo
ana is 31
bo is 25
0
4
8
```

`at` names the index. A map gives its entries as tuples, in the order they were added, and the tuple is taken apart in place.

## Comprehensions

```lerta
names := ['ana', 'bo', 'al']
print [name.to_upper() for name in names when name.starts_with('a')]

lines := [
  for (name, age) in { 'ana': 31, 'bo': 25 }
    label := age >= 30 then '30+' else 'under 30'
    "#{name}: #{label}"
]
print lines
```

```output
['ANA', 'AL']
['ana: 30+', 'bo: under 30']
```

A comprehension builds an array from a `for`, with `when` to filter. With the `for` first, its block computes each item.

For the rules, see [Array](../reference/types.md#array), [Map](../reference/types.md#map), [Set](../reference/types.md#set) and [for](../reference/control-flow.md#for-and-ranges).
