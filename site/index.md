# Lerta

Lerta is a statically typed, compiled language with CoffeeScript-like syntax and TypeScript-like type inference. It compiles to native code through LLVM.

```lerta
text := 'the quick fox and the lazy dog and the end'

counts: Map<String, Int>
for word in text.split(' ')
  counts[word, default: 0] += 1

for (word, count) in counts.to_array().sorted_by(((_, n)) -> -n)
  print "#{word.pad_end(6)} #{'*'.repeat(count)}"
```

```output
the    ***
and    **
quick  *
fox    *
lazy   *
dog    *
end    *
```

## Shape shows structure

Blocks are indented, as in the program above, with no braces and no `end`, and the formatter lays out every program one way, so code is seen before it is read, and all Lerta code looks alike.

## Types, mostly inferred

```lerta
interface Shape
  area: () -> Float

struct Square
  side: Float
  area := -> @side * @side

struct Rect
  w: Float
  h: Float
  area := -> @w * @h

shapes: Shape[] = [Square(2), Rect(w: 1, h: 3)]
print shapes.map((shape) -> shape.area()).sum()
```

```output
7.0
```

Types are written where they say something, as for fields, and inferred elsewhere: the methods' results above, and the locals. A type satisfies an interface by having its members, without naming it.

## Safe by default

```lerta
struct User
  name: String
  email: String?

users: User[] = [{ name: 'ana', email: 'ana@example.com' }, { name: 'bo', email: nil }]

for name in ['ana', 'bo', 'cy']
  if user := users.find((u) -> u.name == name)
    print "#{name}: #{user.email else 'no email'}"
  else
    print "#{name}: no such user"
```

```output
ana: ana@example.com
bo: no email
cy: no such user
```

There is no undefined behavior outside C functions: no null that any value may be, no index out of range read, no integer overflow unseen. Programs are single-threaded, with an event loop, so they have no data races.

## Fast without a GC

Memory is reference counted, with no tracing garbage collector, and generics are monomorphized. Lerta is faster than Swift and Node.js in most benchmarks, and on par with Go. The geometric mean of [the benchmarks](../bench/README.md), in seconds, lower is better, on Linux x86-64 on 2026-11-14 (C's leaves out regular expressions, which its standard library lacks):

| Lerta | Swift | Go | Node.js | C |
|---|---|---|---|---|
| 0.31 | 0.41 | 0.39 | 0.58 | 0.27 |

## Status

Lerta is in early development. The compiler, written in Lerta, runs on Linux, macOS and Windows. What works today is in [the reference](reference/README.md), and what is left in [the roadmap](roadmap/README.md), such as package management, a test runner, a REPL and a playground.

## Get started

Build the compiler from [the source](../README.md#building), then run a program:

```
bin/lerta run examples/hello.lerta
```

## Learn more

- [The tour](tour/README.md) shows the language in short programs.
- [The reference](reference/README.md) has its rules and its standard modules.
- [The philosophy](philosophy.md) tells why it is as it is.
