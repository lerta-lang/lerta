# Classes and memory

## Classes

```lerta
class Counter
  args
    label: String
    step := 1
  var count = 0

  increment := -> @count += @step

c := Counter('clicks')
c.increment()
c.increment()
print "#{c.label}: #{c.count}"
```

```output
clicks: 2
```

A class is an object shared by reference, whose `var` fields can change. Its constructor arguments are declared in `args`, apart from its own state. There is no inheritance: types share behavior through [interfaces](interfaces.md).

## Reference counting

```lerta
class File
  args
    path: String

  deinit := -> print("closing #{@path}")

open := ->
  file := File('a.txt')
  print "using #{file.path}"

open()
print 'done'
```

```output
using a.txt
closing a.txt
done
```

Objects are reference counted, with no tracing garbage collector: an object is freed as soon as the last reference to it goes, and its `deinit` runs then. So cleanup happens at a known point, without pauses.

## Weak references

```lerta
class Node
  args
    name: String
    weak parent: Node?
  children: Node[] = []

  add := (name: String) ->
    child := Node(name, parent: @)
    @children.push child
    child

root := Node('root')
leaf := root.add('leaf')
print leaf.parent?.name else 'none'
```

```output
root
```

Reference counting does not free cycles. A `weak` field holds an object without keeping it alive, so a child refers to its parent without a cycle; it reads nil once the object is gone.

For the rules, see [objects](../reference/objects.md#classes-and-structs) and [memory](../internals/memory.md).
