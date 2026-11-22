# Lerta

Lerta is a statically typed language that compiles to native code through LLVM, with CoffeeScript-like syntax and TypeScript-like type inference. Lerta code has no undefined behavior, and its memory is managed without a tracing garbage collector. Against each of Go, Swift and Node.js, it is as fast or faster in most of [its benchmarks](../bench/README.md).

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

Code is seen before it is read, so its shape should show its structure. Blocks are marked by indentation alone, with no braces and no `end`, and the formatter lays out every program the same way, so all Lerta code looks alike.

## Types, mostly inferred

```lerta
average := (xs: Int[]) -> xs.sum() / xs.length  # gives an Int

scores := { 'ana': [90, 72], 'bo': [65, 80, 71] }  # a Map<String, Int[]>
print "#{name}: #{average(xs)}" for (name, xs) in scores
```

```output
ana: 81
bo: 72
```

Only the parameter's type is written here. The return type of `average`, the type of `scores`, and the types of `name` and `xs` in the loop are inferred, and all of them are checked at compile time.

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

Lerta code has no undefined behavior. A value can be nil only where its type says so, as `String?` does above, and the compiler makes the program handle nil before it uses the value. An index out of range or an integer overflow throws an exception instead of corrupting memory or wrapping around. Programs are single-threaded, with an event loop as in Node.js, so they have no data races. Only calls to functions written in C are outside these guarantees.

## Reference counting, with cycle checks

```lerta
class Node
  args
    name: String
    weak parent: Node?
  children: Node[] = []

  deinit := -> print("freed #{@name}")

build := ->
  root := Node('root')
  root.children.push Node(name: 'leaf', parent: root)
  print 'built'

build()
print 'done'
```

```output
built
freed root
freed leaf
done
```

Memory is reference counted: an object is freed as soon as its last reference goes away, as both nodes are when `build` returns, with no tracing garbage collector to pause the program.

Reference counting does not free objects that refer to each other in a cycle, and Lerta does not collect them. Instead, it helps you avoid cycles:

- **`weak` references**, such as `parent` above, refer to an object without keeping it alive.
- **The compiler warns** about the cycles it can see: a function that captures `@`, the object itself, and is stored in that object, or given to a method that stores it there.
- **Debug builds report leaks.** Without `weak` above, the program ends with `leak: 4 unreachable object(s): Node (2), Array (2)` and a failing exit code, so that tests catch what the compiler cannot see.

## Fast

Generics are monomorphized, and exceptions compile to ordinary return values. In most of [the benchmarks](../bench/README.md), Lerta is as fast as Go, Swift and Node.js, or faster. The times in seconds, lower is better, measured on Linux x86-64 on 2026-11-22:

| Benchmark | Lerta | Swift | Go | Node.js | C |
|---|---|---|---|---|---|
| binary_trees | 0.13 | 0.29 | 0.21 | 0.12 | 0.13 |
| expr | 0.29 | 0.38 | 0.36 | 0.99 | 0.35 |
| fib | 0.35 | 0.35 | 0.34 | 0.62 | 0.10 |
| iter | 0.19 | 0.19 | 0.19 | 1.57 | 0.25 |
| json | 0.45 | 1.01 | 0.42 | 0.73 | 0.52 |
| mandelbrot | 0.32 | 0.32 | 0.34 | 0.35 | 0.32 |
| nbody | 0.51 | 0.32 | 0.53 | 0.49 | 0.34 |
| regex | 0.44 | 4.22 | 0.74 | 0.31 | – |
| sieve | 0.24 | 0.25 | 0.22 | 0.30 | 0.22 |
| tokens | 0.19 | 0.30 | 0.22 | 0.44 | 0.14 |
| word_count | 0.66 | 1.83 | 0.56 | 0.88 | 0.52 |

C is included as a baseline. The benchmarks are small programs that were written for this project, in each language, and Lerta has been tuned on them. [Method](../bench/README.md#method) explains how they are built and timed, and what to keep in mind when reading the results.

## Status

Lerta is in early development: there are no releases yet, and the language and its standard library may still change incompatibly. The compiler is written in Lerta, builds itself, and runs on Linux, macOS and Windows. [The reference](reference/README.md) describes what works today. [The roadmap](roadmap/README.md) describes what is planned, such as package management, a test runner, a REPL and a playground.

Almost all of the code was written by AI coding agents, directed by the author.

## Get started

There are no binary releases yet, so build the compiler from source. You need make and clang: [Tools](reference/compiler.md#tools) lists what each system needs, and [Getting started](../README.md#getting-started) has the details.

```
git clone https://github.com/lerta-lang/lerta
cd lerta
make
bin/lerta run examples/hello.lerta
```

## Learn more

- [The tour](tour/README.md) introduces the language through short programs.
- [The reference](reference/README.md) specifies the language, its standard library and the `lerta` command.
- [The philosophy](philosophy.md) explains why Lerta is the way it is.
