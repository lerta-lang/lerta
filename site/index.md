# Lerta

Lerta is a statically typed, compiled language with CoffeeScript-like syntax and TypeScript-like type inference. It compiles to native code through LLVM.

```lerta
struct Circle
  r: Float
  area := @r * @r * PI

print "area: #{Circle(r: 2).area}"
```

Lerta is in early development: what works today is in [the reference](reference/README.md), and what is left in [the roadmap](roadmap/README.md). The reasons behind its design are in [the philosophy](philosophy.md).

## Getting started

Build the compiler from [the source](../README.md#getting-started), then compile a program:

```
bin/lerta build examples/hello.lerta
```
