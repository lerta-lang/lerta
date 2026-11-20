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

Lerta is in early development: what works today is in [the reference](reference/README.md), and what is left in [the roadmap](roadmap/README.md). The reasons behind its design are in [the philosophy](philosophy.md).

## Getting started

Build the compiler from [the source](../README.md#getting-started), then compile a program:

```
bin/lerta build examples/hello.lerta
```
