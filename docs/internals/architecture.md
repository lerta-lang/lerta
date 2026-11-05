# Architecture

## Overall architecture

- The compiler writes `.ll` text, one file per module (see [per-module output](#per-module-output)), and has `clang` compile it and link it with the runtime.
- The event loop is in the C core of the runtime (see [the event loop](iteration.md#the-event-loop)).

### Inlining the runtime

- An optimized build lets LLVM inline the runtime's C functions, such as `lerta_retain`, into the generated code: the runtime takes part in the link-time optimization of the modules.
- LLVM inlines a function only into one with the target features it was compiled for. So every generated function has the target's attributes (the CPU and its features) that clang gives a C function compiled with the same flags. The runtime's cache keeps them (`compiler/runtime_cache.lerta`).
- `lerta_release` keeps the dropping of an object out of line, so that the rest is small enough to inline.
  - Inlining it and `lerta_retain` makes the compiler's front end about a quarter faster, and its optimized build about twice as slow, as LLVM then optimizes much more code.
- `lerta_retain` and `lerta_release` return at once for null, which only a reference with nil is.
- An array's item of a reference type without nil is read with an `llvm.assume` that it is not null (`load_indexed_item` in `compiler/codegen/array.lerta`), so that its inlined retain or release checks nothing. No code writes null into the items below the length.
  - This took 1.15% of the compiler's instructions off, and 0.9% of `bench/nbody`'s. The same for fields took fewer off the compiler, and none off `bench/binary_trees`, which goes through them.

### Per-module output

- The front end checks and generates the whole program at once, but `build` writes one LLVM module per Lerta module (`compiler/codegen/ir_linking.lerta`).
- clang compiles the modules at once, each in a process of its own, and links them. An optimized build optimizes them in parallel with ThinLTO (`-flto=thin`), which imports into each module the functions of the others that it inlines, the runtime's among them.
  - Why: one large module would be optimized on one thread, and would gain little over full LTO.
- `dump-llvm` prints the modules as one, which declares nothing of its own, so that the seed is one `.ll` and `make test-bootstrap` compares one.

#### Stable paths for the cache

Each build's objects must be found again in [the ThinLTO cache](../reference/compiler.md#cache):

- Each module names its `source_filename`; clang would otherwise give it the path of its `.ll`, in the build's temporary directory.
- The link runs in that directory, which `build` gives clang as its working directory, and names the modules' objects relative to it, `module<N>.o`.
  - Why: LLVM may hold the path of each object, as the linker is given it, in the cache's keys, as clang 15's does. An absolute path under a build's own temporary directory is never found there again.
- Other relative paths given to the link are resolved below the directory the compiler runs in, by `real_path`, so that the system works out each `..` and symbolic link from there, as when clang ran in that directory (see [real_path](../reference/std.md#stdio)).
- What the build makes itself (the runtime's objects, the cache and the temporary directory) is resolved itself, as it always exists when the link runs; so it is named the same from any directory.

#### What a module's IR depends on

A module's IR depends only on the module and the declarations it uses:

- Symbols are named after the module's path and the declaration (see [modules](compiler.md#modules)), not numbered across the program, so that adding or removing a module renames nothing in the others.
- What a module makes on demand, such as function literals, constants, itabs and equality functions, is numbered within it, and private. The rest is external.
- A module declares what it uses of the others, and defines the named types of the others that it uses (the layouts of their classes and structs). What it uses is found in its text, by the names after `@` and `%"`, so the code that generates it does not list them.
- Generic instances are emitted by the modules that use them (see [generics](compiler.md#generics)).
- A module's top-level code is a function of its own. `lerta_main`, the entry module's, calls the others' in the order of initialization.

#### Build times

The compiler's optimized build:

| Host | Full LTO, one module | ThinLTO | After a change to one module | Nothing changed | Unoptimized |
|---|---|---|---|---|---|
| x86-64 Mac, clang 21 | 15 s | 2.7 s | 1.9 s | 1.3 s | 1.2 s |
| x86-64 Linux in Docker, clang 19 | 22 s | 2.8 s | — | 1.1 s | — |

Compiling the runtime once takes 3.7 s more on the Mac. The benchmarks run as fast as with full LTO.

### Checker and codegen

- The checker records what each name and member refers to, where it resolves them; codegen generates names and members by them and looks nothing up again.
  - A name's reference (`NodeFacts.references`, kinds in `compiler/checker/references.lerta`): a local of a scope (which codegen finds in its own scopes by the name), a module's top-level value, a function, a C function, a constructor, `Map` or `Set`, or an enum member.
  - A member's target (`NodeFacts.members`, targets in `compiler/checker/member_targets.lerta`): a field or builtin property, a method with its source, a property of an interface value, an enum member, or an enum's `parse`.
  - An itab's entries hold the targets of the type's members alike.
- The checker leaves the syntax tree as written, and records the nodes it makes for codegen in the facts, by the written ones: an operator's method call, say, and the arguments a call passes (`NodeFacts.arguments`), with variadic arguments packed into an array and named arguments gathered into a struct.
  - Why: the instances of a generic function share their literal, and `lerta fmt` checks a program more than once.
- The representation of the non-reference types (the integer types, `Float`, `Bool` and enums) comes from one row per type (`compiler/codegen/scalar.lerta`): the IR type, the bits and the sign. From these a value becomes a word and back, and is extended as an argument or result of C.
  - The integer types' bits and sign come from `compiler/types.lerta`, which the checker and the checked arithmetic read too.


## Runtime rules

- The core of the runtime (RC, the representation and basic operations of strings, arrays and maps) is **written in C** and shared by all stages.
  - `runtime/lerta.h` declares what the generated code, std and C files linked with a program use; `runtime/internal.h` what only the runtime's own C code uses.
- Builtins and standard modules are written in Lerta where possible (such as `print`).
  - C is limited to the minimal primitives that Lerta cannot write (writing to an fd, memory allocation and so on).
  - The compiler is limited to the operations that need the representation of the builtin types (see [builtins](representation.md#builtins)).
- Objects, and the buffers they own, come from the runtime's allocator; only the runtime's own buffers come from `malloc` (see [allocation](memory.md#allocation)).
- What differs between systems is in the platform functions alone (see [platforms](platforms.md#platforms)).
  - The rest of the runtime calls no system functions, but libuv's for what waits (see [the event loop](iteration.md#the-event-loop)).
  - Of the C library, it uses only the memory, string, number and sorting functions.
- There are no threads, which [memory management](memory.md) and [exceptions](execution.md#exceptions) rely on.


## Bootstrap

- The compiler was first written in TypeScript (stage0), which built its rewrite in Lerta; it has been built by itself since, and stage0 is gone.
- So building it takes a Lerta compiler: **the seed**, `seed/minilerta.ll`. It is the LLVM IR of `compiler/minilerta.lerta`, the compiler with no more than it needs to bootstrap, as `dump-llvm` prints it in [seed mode](#seed-mode).
- The IR names no target (clang is given it), so the one seed builds on every platform.

### Stages

Given a source, minilerta prints its IR, as `dump-llvm` does. Only make and clang are needed.

- The Makefile builds minilerta from the seed, and with it `tools/build.lerta` into `build/build`, which builds the rest for the goals of `make`, each of which runs it.
- `build/build` makes again, as make does, what is missing or older than what it is made from.

| Step | Built by | With |
|---|---|---|
| `build/minilerta` | clang, from the seed | the debug runtime |
| `build/build` | clang, from minilerta's IR of `tools/build.lerta` | the debug runtime |
| `build/stage1` | clang, from minilerta's IR of `compiler/` | the debug runtime |
| `bin/lerta` | stage1 | optimized, without the memory checks (see [leak checking](memory.md#leak-checking)) |

Every build so checks that the seed builds the current source.

### Embedded files

- The compiler carries `std/*.lerta`, `runtime/*.c` and `runtime/*.h` as string constants of the generated module `build/embedded.lerta`.
- `build/build` writes the module (`tools/build/embed.lerta`) from the files that it finds in those directories, so no list of them is written by hand.
- The loader reads a standard module from it, and `build` writes the runtime from it for clang to compile into [the cache](../reference/compiler.md#cache).

### Seed mode

- The seed is built in seed mode. Its `embedded.lerta` holds neither the files nor their paths.
  - It finds the files of `std/` as the compiler starts, with `list_dir`, and reads them all with `read_file`, which awaits, so that `embedded_source` is the same function in both modes.
  - The paths are relative to the current directory, so minilerta must run from the repository's root, as the Makefile and `build/build` run it.
  - It holds nothing of the runtime and libuv, which minilerta, printing IR only, does not use.
- So stage1 is built with the working tree's std and runtime, and the seed does not hold them.
- `make seed` writes such a module beside a copy of `compiler/`, in `build/seed/`, so that the build's own one stays as it is.

### make test-bootstrap

- `bin/lerta` builds the compiler (stage2), and stage2 builds it again (stage3), both with `-Werror`, as stage1 builds `bin/lerta`; so the compiler's source has no warnings.
- `bin/lerta` and stage2 must print the same IR for the compiler with `dump-llvm`.
- `bin/lerta` also builds `compiler/minilerta.lerta`, for the host, which nothing else builds until `make seed`; it must print the same IR too.
- Only the IR is compared: the executables differ, since the linker writes a different identifier into each.
- With `TARGET=<target>`, stage2 and stage3 are built for that target, so that stage3's IR comes from the compiler running there (the tests do so for other targets, as the [README](../../README.md#cross-testing) says).

### Refreshing the seed

- The seed is refreshed only when the compiler's source is about to use a language feature that the seed compiler lacks.
- A change to std or the runtime that the seed compiler can build needs no refresh, a file added, removed or renamed included: minilerta finds and reads std's files in the working tree, and the runtime is linked from it.
- The seed need not write the same IR as `bin/lerta`, only build the source.
- Why only when needed: each refresh stores the seed again in the repository's history.

The steps for a new feature:

1. Implement the feature in a form that the current seed compiler can build, without using it in `compiler/`.
2. Run `make seed`. It runs `make test-bootstrap` and writes, as the new seed, the IR that `bin/lerta`, which has the feature, generates for `compiler/minilerta.lerta` in seed mode. Check the new seed with `make clean && make test`, and commit it.
3. The compiler's source may then use the feature.

### LLVM versions

- The seed's IR, and so minilerta's, is for LLVM before 23, whose `llvm.coro.end` returns an `i1`, which the IR drops.
  - For a clang whose LLVM declares it `void`, which the Makefile finds by compiling a call of it, the Makefile rewrites the declaration and the calls in that IR before clang builds it (`build/host_llvm.sed`).
- The IR, the seed's and the compiler's own, uses:
  - opaque pointers (`ptr`), which LLVM 15 made its default and LLVM 14 reads only with `-opaque-pointers`;
  - the `presplitcoroutine` attribute, which LLVM 15 took in place of LLVM 14's `"coroutine.presplit"`, and which no flag makes LLVM 14 read.
- So clang 15 is the oldest that builds a Lerta program. LLVM 14's `CoroSplit` pass also fails on an opaque-pointer coroutine.

