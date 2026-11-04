# Internals

This describes the implementation's design. The planned design is in [the roadmap](roadmap/README.md); behavior that programs see is in [the reference](reference/README.md).

## Overall architecture

- The compiler writes `.ll` text, one file per module (see [per-module output](#per-module-output)), and has `clang` compile it and link it with the runtime.
- The event loop is in the C core of the runtime (see [the event loop](#the-event-loop)).

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

Each build's objects must be found again in [the ThinLTO cache](reference/compiler.md#cache):

- Each module names its `source_filename`; clang would otherwise give it the path of its `.ll`, in the build's temporary directory.
- The link runs in that directory, which `build` gives clang as its working directory, and names the modules' objects relative to it, `module<N>.o`.
  - Why: LLVM may hold the path of each object, as the linker is given it, in the cache's keys, as clang 15's does. An absolute path under a build's own temporary directory is never found there again.
- Other relative paths given to the link are resolved below the directory the compiler runs in, by `real_path`, so that the system works out each `..` and symbolic link from there, as when clang ran in that directory (see [real_path](reference/std.md#stdio)).
- What the build makes itself (the runtime's objects, the cache and the temporary directory) is resolved itself, as it always exists when the link runs; so it is named the same from any directory.

#### What a module's IR depends on

A module's IR depends only on the module and the declarations it uses:

- Symbols are named after the module's path and the declaration (see [modules](#modules)), not numbered across the program, so that adding or removing a module renames nothing in the others.
- What a module makes on demand, such as function literals, constants, itabs and equality functions, is numbered within it, and private. The rest is external.
- A module declares what it uses of the others, and defines the named types of the others that it uses (the layouts of their classes and structs). What it uses is found in its text, by the names after `@` and `%"`, so the code that generates it does not list them.
- Generic instances are emitted by the modules that use them (see [generics](#generics)).
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
  - The compiler is limited to the operations that need the representation of the builtin types (see [builtins](#builtins)).
- Objects, and the buffers they own, come from the runtime's allocator; only the runtime's own buffers come from `malloc` (see [allocation](#allocation)).
- What differs between systems is in the platform functions alone (see [platforms](#platforms)).
  - The rest of the runtime calls no system functions, but libuv's for what waits (see [the event loop](#the-event-loop)).
  - Of the C library, it uses only the memory, string, number and sorting functions.
- There are no threads, which [memory management](#memory-management) and [exceptions](#exceptions) rely on.

## Bootstrap

- The compiler was first written in TypeScript (stage0), which built its rewrite in Lerta; it has been built by itself since, and stage0 is gone.
- So building it takes a Lerta compiler: **the seed**, `seed/minilerta.ll`. It is the LLVM IR of `compiler/minilerta.lerta`, the compiler with no more than it needs to bootstrap, as `dump-llvm` prints it in [seed mode](#seed-mode).
- The IR names no target (clang is given it), so the one seed builds on every platform.

### Stages

Given a source, minilerta prints its IR, as `dump-llvm` does. Only make and clang are needed.

| Step | Built by | With |
|---|---|---|
| `build/minilerta` | clang, from the seed | the debug runtime |
| `build/stage1` | clang, from minilerta's IR of `compiler/` | the debug runtime |
| `bin/lerta` | stage1 | optimized, without the memory checks (see [leak checking](#leak-checking)) |

Every build so checks that the seed builds the current source.

### Embedded files

- The compiler carries `std/*.lerta`, `runtime/*.c` and `runtime/*.h` as string constants of the generated module `build/embedded.lerta`.
- clang builds `tools/embed.lerta` from minilerta's IR, and it writes the module from the files that the Makefile lists, so no list of them is written by hand.
- The loader reads a standard module from it, and `build` writes the runtime from it for clang to compile into [the cache](reference/compiler.md#cache).

### Seed mode

- The seed is built in seed mode (`embed --seed`). Its `embedded.lerta` holds neither the files nor their paths.
  - It finds the files of `std/` as the compiler starts, with `list_dir`, and reads them all with `read_file`, which awaits, so that `embedded_source` is the same function in both modes.
  - The paths are relative to the current directory, so minilerta must run from the repository's root, as the Makefile runs it.
  - It holds nothing of the runtime and libuv, which minilerta, printing IR only, does not use.
- So stage1 is built with the working tree's std and runtime, and the seed does not hold them.
- `make seed` writes such a module beside a copy of `compiler/`, in `build/seed/`, so that the build's own one stays as it is.

### make test-bootstrap

- `bin/lerta` builds the compiler (stage2), and stage2 builds it again (stage3), both with `-Werror`, as stage1 builds `bin/lerta`; so the compiler's source has no warnings.
- `bin/lerta` and stage2 must print the same IR for the compiler with `dump-llvm`.
- `bin/lerta` also builds `compiler/minilerta.lerta`, for the host, which nothing else builds until `make seed`; it must print the same IR too.
- Only the IR is compared: the executables differ, since the linker writes a different identifier into each.
- With `TARGET=<triple>`, stage2 and stage3 are built for that target, so that stage3's IR comes from the compiler running there (the tests do so for other targets, as the [README](../README.md#building-and-testing) says).

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

## Compiler

### Modules

- A module's symbols are named by its path, rather than by its place among the modules, which changes as others are added:
  - from the entry module's directory (absolute if it is on another root, such as another drive): `lerta.fn.ast.lerta.parse`;
  - `std:name` for a standard module;
  - `./` and its file name for the entry module, which no other path starts with: `lerta.fn../main.lerta.main`.
- Names are quoted in the IR, with the bytes other than printable ASCII, `"` and `\` escaped as in strings.

#### Top-level values

- Reading a top-level value through a function before it is initialized is detected with an initialized flag, and so is reading an imported value of a module of the same import cycle.
- The check is optimized away where initialization is certain: in top-level code, for the module's own values and those of modules outside the cycle, which have run.
- A function always checks, since a `deinit` can run while the values are released at exit, each unset before its release.
- A `const` whose value is a literal or a constant expression of its own type is read as that value, in place, in its module and in others, never through its global (`constant_of` in `compiler/codegen/top_level.lerta`).
- The checker evaluates constant expressions in the compiler's own arithmetic of their types, as the program would, catching the `ArithmeticError` it throws for a compile error (`compiler/checker/constants.lerta`). It records their values in its facts, which codegen writes in their places; a top-level const's value goes with its local and its export.

#### Checking order

- The checker checks the modules step by step, each step for all of them before the next, so that the modules of a cycle can use each other's names:
  1. their names;
  2. their declarations;
  3. their extends (those of the modules of the cycle that run later last);
  4. their top-level code, in the order it runs;
  5. the bodies of their functions and the initializers of their fields.
- An export is worked out when an importer asks for it, and an inferred type on demand, across modules as within one.

### Generics

- Each module emits the instances that it uses, as `linkonce_odr`, so that the linker keeps one of each (see [per-module output](#per-module-output)): those that its code names, and those that their bodies name in turn.
  - Instances of generic functions and methods, and of generic classes and structs: their layouts, constructors and types.
- An instance's body sees the names of the module that declares the generic one.
- An instance is named by the function's and the type arguments' names (`lerta.fn.std:builtins/text.print<Int>`), and for a method, the receiver's too (`lerta.extend.std:builtins/collections.Self.map<Array<Int>, Int, String>`).
- An instance checks the function literal with the type parameters standing for its type arguments, and keeps the types and other facts of the literal's nodes apart from those of the other instances.
- **Witnesses.** Besides its module's extends, an instance's body sees (`add_witnesses` in `compiler/checker/generic_call.lerta`):
  - the methods of the extends in effect at the call that satisfy the bounds;
  - in turn, those that satisfy the bounds of a generic method that satisfies a bound's member, an extend's or a class's or struct's own.
  - Instances of the same type arguments whose witnesses differ are told apart by a number after the name.

#### Checking a definition

- A generic function's body is checked once at its definition (`check_definition` in `compiler/checker/generics.lerta`): before its first instance, or, for one that no call instantiates, after the instances of every module.
- Each type parameter is then a `TypeParameterType` that is `standing`: a type of its own, which no type pattern binds, whose members come from its bound by `Resolver.bounds` (`bound_method` in `compiler/checker/member.lerta`), as an interface value's do.
- An error there is the generic's, and its instances are not checked.
- What that check finds goes to its own `Definition.facts`, which codegen never reads:
  - a call of a generic function with standing type arguments makes no instance but a signature: the callee's definition with the type arguments put in (`signature`, `substitute_standing`);
  - an instance of a generic class or struct of standing type arguments is a view kept apart from the instances (`ObjectInfo.standing`);
  - the type names it resolves are not recorded for an editor.

### Defaults

- A function with [defaults](reference/functions.md) takes every argument.
- For each number of arguments that a call may give, it has an entry, `<symbol>.given<k>`, which computes the defaults of the others and calls it. A call that leaves arguments out calls the entry.
  - An instance of a generic function has them only if a call leaves arguments out, as only such a call has its defaults checked (`defaults_checked`).
- The function's value and the itabs refer to the function itself, which a default does not change.
- A constructor instead takes, after each argument with a [`default`](reference/objects.md#members), an `i1` of whether it is given, and computes the default of one not given in its place among the initializers.

### Formatter

`lerta fmt` (`compiler/format/`) prints the syntax tree again, and compares that with the source.

- **Document.** The printers make a document (`format/doc.lerta`) of texts, line feeds, indentation, and choices between two forms of a part: the first where its first line fits in 100 columns, the second otherwise.
- **Rules.** A style rule that decides a part marks it, so that a place where the source differs is reported with the rule of the innermost part there.
  - Where only blank lines differ, it is reported under Blank lines.
  - Where only the indentation of the same number of lines differs, under Layout.
- **Source.** What the tree does not keep is read from the source by position (`format/source.lerta`): the spelling of literals, the names of a destructuring, and the keywords before a clause. A text that prints a token carries its position in the source.
- **Comments.** The lexer gives the comments apart from the tokens (`lex`). Laying out the document puts each back by the positions of the texts around it:
  - one on a line of its own before the next text;
  - one that ends a line at the end of the line of the last text of its source line.
  - A choice whose first form would hold a comment between its texts takes the second.
  - A blank line of the source between two texts comes back where the output starts a line.
- **Kept lines.** A statement on lines of its own that holds a line marked `# fmt: skip` or `# fmt: off` is printed as its lines of the source (`format/kept.lerta`), unless a statement in its blocks holds the line: the printers print the inner statements first, which claim their lines.
  - Since which statements are kept shows only once they are printed, the source is printed again with the annotations left on their lines, and with the imports that the kept statements use, if any.
- **Diff.** The lines that differ are found by Myers's algorithm (`format/diff.lerta`).

### The language server

`lerta lsp` is in `compiler/lsp/`.

- **Messages.** It reads each message's `method` and `id` first, as a `Header`, then decodes it again as a `Request<P>` or a `Notification<P>` of the method's params, with `std:json` in camel case (`protocol.lerta`).
- **Open documents.** Their texts are in `open_texts` of `compiler/source.lerta`, keyed by the real paths of their files, or by the path for one that is no file yet (`text_key`). `read_source` reads them in place of the files, so that the loader, the checker and the formatter take them as files.
- **Checks** (`diagnostics.lerta`):
  - It loads the program whose entry module is the document, each module with the statements that parse, in blocks too (`load_modules_partially`, `TokenStream.block_errors`), and checks it as `lerta build` does.
  - Warnings come through `check_modules`'s callback; errors from the `CompileError`, whose `errors` give them where they are found.
  - A file whose statements do not all parse has only its parse errors, since the checker's would mostly be of the names that the unparsed statements declare.
  - The server keeps what each open document's last check found of each file of its program (`server.lerta`), and publishes a file's diagnostics as those of all of them.
  - It keeps each open document's program of its last check whose modules loaded, so that while a text does not load, as one being written, hover and going to a definition answer from the text before it, for the names that the new text still writes where they were.
- **Hover and definitions** (`locate.lerta`) look among the names of the facts of the module's code, and of the instances of its generic functions and classes, for those whose text the source writes at the position.
  - The checker records each expression's type, a name's reference, a member's target, and, for an editor alone, the declaration of the local that a name reads or assigns (`NodeFacts.local_declarations`), and what each type name of a module names (`Shared.type_names`, `Shared.alias_names`).
  - The parser's and the checker's own names, such as `?2:3` of `x?.y` or the `to_string` of an interpolation, are not written in the source, so they are not found.
- **Completion** (`complete.lerta`) checks the program with the name under the cursor replaced by the checker's `COMPLETION_NAME`. Where the checker meets that name, as a name or as a member, it records in `ProgramWide.completion` the locals that the code there sees, or the type of the member's object, or the module or enum that the object names (`compiler/checker/completion_probe.lerta`). The items come from that.

## Execution model

- A function's locals are on the machine stack, in slots that LLVM makes registers.
- A `var` that a closure captures lives in a heap cell of its own.
- A closure holds the values that cannot change (`const`s, parameters, loop variables), copied in, or borrowed for one on the stack (see [objects](#objects)), and the cells of the `var`s it captures.
- What a function that yields or awaits keeps across a `yield` or an `await` is in its coroutine frame, on the heap, which outlives the call that made it (see [functions that yield](#functions-that-yield) and [functions that await](#functions-that-await)). Suspended functions are linked by which one awaits which: a spaghetti stack on the heap.
- Why cells, as Swift boxes each captured `var`, rather than a context of all the captures of a scope (the V8 approach): a context would keep each capture alive as long as any closure of the scope, and would not hold what lives across an `await`, which is in the coroutine frame anyway.

### Exceptions

- **Error return values (the Swift approach).** A throw sets the global pending exception, an interface value of `Error` (there are no threads, so a global is fine), and leaves the function as a `return` does, releasing what its scopes hold.
- **Checks.** Each call that may throw is followed by a check of the pending exception, which leaves the caller in turn, up to a `try` whose `catch` takes the exception, or to the program's end, which reports it as uncaught.
  - Calls that may throw: of a Lerta function, a closure, an itab's entry or a C function of the runtime.
  - Not checked (`may_leave_exception` in `compiler/codegen/builtins.lerta`): a builtin method that calls nothing that may throw, such as a number's conversion or `compare` or an enum's `to_string`; a number's operator called as a method, whose overflow throws as the generated code's own checks do.
- **Branch weights.** The branch of each check to the unwinding, and that of the generated code's own checks to their throw, carries the weights that clang gives `__builtin_expect` (`emit_seldom_branch` in `compiler/codegen/ir_builder.lerta`). LLVM then lays out the code, and assigns registers, for the other way first.
  - So a recursion's base case returns before the registers that the recursion needs are saved. Without the weights, ThinLTO saved them first on the Mac, which made `fib` half as slow again.
- **Hidden.** The pending exception is hidden, in `runtime/lerta.h` and in the generated code's declaration (`exception_global` in `compiler/codegen/exceptions.lerta`), so that a check reads it directly. A symbol that another library might define is reached through the table of addresses, whose entry ThinLTO kept in a register across calls, which a function then saved and restored; hiding it took 11% of `bench/expr`'s instructions off, and 1 to 3% of most others'.
- **Temporaries.** An expression that holds an owned value while it evaluates others, as a call holds its arguments, registers it as a temporary, which an exception releases on its way, as it does the scopes it leaves.
- **Set aside.** A `finally` block, whose calls are checked, runs with the exception set aside; so does a `deinit` that a release runs (`lerta_run_deinit`), which may not throw one of its own.
- **Jumps out of a `try`.** A `return`, `break` or `continue` that leaves a `try` generates a copy of its `finally` block where it jumps, run as the code after the `try` would run it: with the scopes inside the `try` released, and an exception it throws going to the `try`s outside.
  - So a `finally` block is generated once for each jump out of its `try`, besides its ends. A jump through a shared copy would need to tell where to go on after it, which the copies need not.
- Why: unwinding reuses the release on `return` and `break`, needs no tables or `longjmp`, and works alike on every platform. A throw across an `await` cannot unwind the machine stack anyway, since the awaiting function's frame is no longer on it: it is carried as the failure of the asynchronous result, which this approach does within synchronous code too. The cost is a load and a branch after each call.
- Considered: a frame chain with `longjmp` (needs a frame record listing the references in every function) and LLVM's zero-cost unwinding (needs landing pads, unwind tables for the runtime's C code, and Windows' SEH apart).

#### The runtime's errors

- A C function of the runtime that throws calls `lerta_raise` with the error's kind and message, and returns.
- The generated code checks the pending exception after each call of such a function, except where the result alone tells that it threw (`emit_exception_check_if` in `compiler/codegen/exceptions.lerta`): the null items that `lerta_array_checked_items` gives for an index out of range, so that reading or writing an item loads no global.
  - That function tells LLVM that the items of an index in range are not null, so that a loop it is inlined into checks none.
- An array's index is checked as unsigned, which does better where a loop runs to a bound other than the array's length, as in `bench/sieve`.
- A Binary's length and bytes are read in place. Its index, negative or at or beyond its length, throws by the generated code's own check: two signed comparisons, so that LLVM drops the second where a loop's condition has made it, as `i < bytes.length` does. One unsigned comparison could not be dropped without knowing that the index is not negative.
- `lerta_raise` calls a function that the compiler generates in `std:builtins`, which constructs the error of the kind's type and sets it as the pending exception. The error types are structs of the module that declares the `Error` of `std:builtins`. The program registers that function first thing.
  - A program that is `std:builtins` or a module it imports, without those types, registers none; the runtime then stops the program at once.
- The generated code's own checks, such as for overflow, throw the same way where they fail.

### Exception traces

- The trace is made as the exception unwinds, so that it costs nothing until one is thrown.
- **Sites.** Where the generated code throws, or finds that a call has thrown, it calls `lerta_trace_push` with its **site**: a constant of the function's name, the module's file, and the position of the innermost statement or expression (`Generator.position`).
  - Code that is no function of the program, such as an Iter's `has_next`, adds none.
  - A function that the exception leaves adds one entry, at the check of the call that threw; so does an `await`, whose check is that of the promise's result.
  - A runtime error is thrown by the C function that the code calls, so the call's check is its site.
- **One trace.** The runtime keeps one trace, of the pending exception (`runtime/lerta.c`): its **owner** (the exception's data) and the sites pushed.
  - A `throw` and a runtime error start a new trace (`lerta_trace_start`).
  - But a `throw` of a catch's name, which codegen tells by its local (`SlotLocal.caught`), pushes, as a call's check does (`lerta_trace_push`): it goes on with the trace if it is still the exception's own, and else starts one.
  - Catching an exception does nothing to the trace; an exception thrown and caught in the catch replaces it.
  - A freed object owns no trace (`lerta_trace_forget`, as it is freed), so that an exception made at its place does not take its trace.
- **Saved traces.** Where an exception is set aside while code that may throw and catch others runs, its trace is saved and restored with it. Copies are `malloc`ed, as the runtime's own buffers are.
  - Around a `finally` block, the saved copy is a temporary (`Ownership.TRACE`) that an exception leaving the block frees.
  - Around a `deinit` (`lerta_run_deinit`).
  - A rejected Promise keeps a copy for each `await` of it, and for the report of an exception that nothing awaited.
- **Size.** The trace keeps the first 32 sites pushed and the last 32 in a ring, so that it takes a fixed room however deep the exception comes from.
- **Code size.** `lerta_trace_push` is kept out of line, so that LTO does not copy it into every site: a site's code is one call with one argument. The sites make the compiler's own executable some 15% larger; `--no-trace` leaves them out.

#### Source lines

With `--source-lines`, each module's IR carries LLVM's debug information of the line tables (`compiler/codegen/source_lines.lerta`):

- a compile unit;
- a subprogram for each function of the program, by the name that traces give it, starting at the line it is declared at;
- a location on each instruction, of the statement or expression that the generator is at, as the sites are.
  - An instruction before the first, as of the code that a function runs before its body, takes the function's own line, since LLVM requires a location on every call in a function that has a subprogram.
  - Code that is no function of the program has none.
- A function that has a subprogram is `internal` rather than `private`, so that it has a symbol, by which `dsymutil` finds its information on macOS.

### Stack overflow

- **POSIX.** The runtime relies on the guard page below the stack: touching it raises SIGSEGV (or SIGBUS). The handler, on a stack of its own (`sigaltstack`), panics if the faulting address is in the stack's range. A stack without a limit, or with one beyond the address space, has no such range. Other faults keep their default action.
  - It costs nothing per call.
- **Windows** raises `EXCEPTION_STACK_OVERFLOW` in the overflowing thread, on what is left of its stack. A vectored exception handler panics on it; other exceptions go on to the handlers after it.
  - `SetThreadStackGuarantee` keeps 64 KiB of the stack for the handler.
  - The handler writes the message and ends the process with `TerminateProcess` (exit code 3, as C's `abort` gives there), since the code that `ExitProcess` runs may need more stack.

## Memory management

### Reference counts

- **No threads, so counts are non-atomic.**
- An object whose count reaches zero is dropped and freed at once, unless another one is being dropped: it is then queued, and a loop drops and frees the queued objects after it; dropping one may queue more.
  - Why: this keeps the stack flat when a long chain, such as a linked list, is released.
- Static objects, such as string literals, are immortal: exempt from count operations.

### Object headers

- Every heap object starts with a header: its reference count and its **type** (`LertaType` in `runtime/lerta.h`). Every object of the type shares the type, which identifies it for type tests, and holds:
  - its drop function, which releases what the object owns before it is freed;
  - its visit function, which gives a visitor each reference the object holds;
  - its name.
- The drop function releases the references through the visit function, with `lerta_release` as the visitor, so that what is released and what is visited are one list. The generated visit function is `alwaysinline`, so that the drop function calls `lerta_release` directly.
- A String or Binary, which holds nothing, has no type.

### nil

- nil is a null pointer for an optional reference.
- For an optional `Int`, `Float`, `Byte`, `Bool` or enum value, it is `{ i1, T }` with a false flag. `T` is then unspecified, as in one that comes from C, so it is read only where the flag is set.

### Weak references

- A weak field or local holds a weak box of its object instead of the object (`lerta_weak_box` in `runtime/memory.c`), or null for nil. The box is a heap object that points at the object; one box serves every weak field and local of the object.
- A class's object keeps a pointer to its box after its fields.
- The two pointers are not counted: the object's drop function first clears the box's pointer, and the box's clears the object's. So the object is freed as soon as nothing else holds it, and the box once nothing holds it.
- A function literal that captures a weak local holds the box, and so does a weak function literal for `@`. At each call it takes the object from the box, or returns at once if it is gone, and holds it in its outermost scope.

### Ownership and borrowing

- For now, every expression of a reference type yields an owned (+1) reference, and its consumer releases it.
  - Arguments are borrowed, and released by the caller after the call, except a constructor's, which it takes over (see [objects](#objects)).
  - A discarded statement value is released at once.
  - An immortal literal is owned for free.
- The exceptions below are borrowed rather than owned (`generate_borrowed` and `borrowing_all` in `compiler/codegen/borrowing.lerta`), so that a loop over an array, or a walk down a tree that passes its nodes on, retains and releases nothing.

#### Where a value is borrowed

A value is borrowed only by these consumers (`generate_borrowed`):

- the array or map of an index, or of an assignment to one;
- the object of an assignment to a field;
- an argument of a call, and the function value that a call calls;
- the object of a method call, or of a field or property read;
- the value of a test against nil;
- the subject of a `case`, but not a `var`'s, which an arm may assign (`is_borrowable_in_scope`).

#### What is borrowed

- **A local that is not a `var` (a `const`, a parameter or a loop variable), `@` or a top-level `const`** (`is_borrowable` in `compiler/codegen/borrowing.lerta`). The local keeps the value for the whole use, as a top-level `const` does until the end of the program, where each value is unset before it is released (see [top-level values](#top-level-values)).
- **A `var`**, where nothing can reassign it meanwhile and drop what it held: one that no closure captures and that is not top-level, which only its function's own statements assign, unless what its consumer evaluates while it uses it, such as later arguments, holds an assignment to its name, as the block of a `case` may (`names_assigned`).
- **A field read**, from an object that is borrowed:
  - where the field holds the same value as long as its object lives: a field of a struct, or one of a class that is not `var` or that no assignment in the program changes, of any instance of a generic class or through a union (`is_assigned_field`, which the checker records as it checks the assignments, all before codegen);
  - or where its consumer runs no code of the program before it is done with it, so that nothing can replace the field meanwhile (`is_borrowable`): as the object of a field or property read (`a.b` of `a.b.c`), the value of a test against nil, or the array or map of an index whose position is a name or a literal, that puts no default, and of a map whose keys are found without functions (which a key's own `hash` and `==` would be);
  - not a `weak` field, nor one narrowed to a member of a union in a box.
- **An array's item**, from an array that is borrowed, not in place (as its position may run code), where no code of the program takes out an item of an array of its type, by `xs[i] = x` or `pop`, which `truncate` calls (`are_items_taken`, which the checker records as it checks each instance of a generic function, before codegen). The item then stays in its array as long as the array lives: `b := bodies[j]` in a loop retains and releases nothing.
- **A `const` initialized by a borrowed value** holds it borrowed for its whole scope (`holds_borrowed` in `compiler/codegen/function.lerta`, through `is_borrowable_in_scope`), where:
  - the value is borrowed from no `var`, which any statement of the scope may assign;
  - and the body does not suspend, as the source may change meanwhile.
  - Reading it, as returning or capturing it, retains it as reading any local does.

Not borrowed:

- a captured or top-level `var`, which a function called meanwhile may assign;
- a weak local's object, which may go meanwhile;
- a value converted to another type, which the conversion makes anew;
- the object of an Iter's `has_next` and `next`, which they take over.

### Leak checking

The leak report is described in [the reference](reference/compiler.md#build).

- **Counting.** A debug runtime counts live objects (allocations minus releases, excluding immortal static objects), the frames of coroutines among them. It keeps the objects in a list, through the prefix before each (`LertaPrefix` in `runtime/internal.h`), in `runtime/leaks.c`, which does the checks below.
- **Trial deletion.** As the program ends, it finds the objects that nothing in use holds, as CPython's cycle collector does:
  - It takes from each object's count the references that the objects hold, which each object's type visits.
  - What is left is held from outside the objects (by a local, a top-level value, a coroutine's frame or the runtime), so those objects, with what they hold in turn, are in use.
  - The rest, held only by objects that nothing in use holds, such as a cycle and what it holds, are reported by their types' names.
  - So no roots are listed, and the check works wherever the program ends, through `exit` too, with whatever is in use, which is not released then.
  - Its counts are spent, so nothing runs after it.
- **What it cannot visit** counts as held from outside: a coroutine's frame, whose layout LLVM makes (see [functions that yield](#functions-that-yield)), and so a generator's `Iter`, which holds its coroutine. A cycle through one is not reported as unreachable; at the end of the top-level code it is counted among what is left alive.
- **At the end of the top-level code**, where everything has been released, what is left alive besides is reported by its count.

#### Which builds check

- Release builds do not count.
- A build without `-O`, or with `--memory-checks`, uses the debug runtime: the runtime compiled with `LERTA_DEBUG`. With `-O`, it is optimized as the release one is, and its cache is named `release-checked`.
- A leak ends the program with `LERTA_LEAK_EXIT_CODE` (`runtime/internal.h`). So these fail on a leak by the exit status:
  - the run tests, which build so;
  - the compiler's own builds that run with the debug runtime: minilerta, stage1 and the bootstrap's stage2.
- `bin/lerta` is built without the checks, so the compiler's leaks are found by stage2. Since the compiler's source exercises only some of the compiler, the leak checks have stage2 run `dump-llvm` and `fmt` on every source of the tests and examples, for the host, and so on every standard module they import.
  - Not checked: the other commands, such as `build`, `fmt --fix` and `lsp`, and the code only for other systems.

### Allocation

- The runtime's own allocator (`lerta_mem_alloc`, `lerta_mem_realloc` and `lerta_mem_free` in `runtime/allocator.c`) allocates objects, the buffers they own (such as an array's items), and the frames of coroutines.
- The runtime's own buffers, which a program does not make often, stay with `malloc`:
  - its queues, such as of what is to be dropped, which grow seldom;
  - what it hands to libuv, such as the output of a program that it runs;
  - what it holds for a system call, such as a path as a C string; some of these the C library gives, as `realpath` and `strdup` do, and must go back to `free`.
- libuv keeps `malloc` too, since its thread pool may allocate, which the allocator, without locks, does not allow.
- **Reallocation.** `lerta_mem_realloc` keeps the place while it holds the new size and is not more than twice as large, and else moves the contents to a new one. So growing an array copies its items at each step beyond its place, as `realloc` does unless it can grow in place.
- A frame's size is rounded up to a multiple of 16, whose places are aligned to 16 bytes, as malloc aligns.

#### Regions

- All the allocator hands out lies in a region from the system, aligned to 64 KiB, so that the region of anything allocated is its address with the low 16 bits cleared, and freeing needs no size.
- Regions come from platform functions (see [platforms](#platforms)), which a microcontroller would replace with a static heap:
  - on POSIX, `mmap`, which over-allocates and unmaps what lies outside the alignment;
  - on Windows, `VirtualAlloc`, whose allocations are aligned to 64 KiB.
- A region starts with a header that tells what it holds.

#### Size classes

- A region of 64 KiB is a **slab** of places of one size class:
  - from 16 up to 256 bytes, in steps of 8, since an object is a header and fields of 8 bytes on a 64-bit system and needs no more alignment, which no object of the runtime may need either;
  - above, each range between two powers of 2 split in 4, so that rounding up wastes at most about a fifth, up to 16 KiB.
- Anything larger takes a region of its own, whose header gives its size.
- A slab keeps its size class in its header, so that freeing does not compute it. The header takes room from the places, which, at 16 KiB, leaves a quarter of the slab unused.

#### Allocating and freeing

- **Allocation** takes a place from the free list of the first slab of the size class with room, or else from the part of it never used yet. Each class keeps a list of its slabs with room; a new slab is taken when there is none.
- **Freeing** puts the place back on its slab's free list, or returns a region of its own to the system.
- **Fast path.** `lerta_mem_alloc` itself takes a small place only from a slab that still has room after it, and leaves every other case to a function of its own. So it is small enough for LLVM to inline into the generated code, where the size is a constant and its size class is computed as it is built.

#### Empty slabs

- A slab whose last place is freed, unless it is the last of its class with room, is kept for reuse by any class and never unmapped.
  - So a program that drops a structure and makes another as large, as `json` in `bench/` does with what it parses, maps no slab again for it, and none maps more slabs than it used at once.
- A slab that no allocation takes for a round is discarded, with `madvise` on POSIX and `MEM_RESET` on Windows, which lets the system take its pages back while it stays mapped.
  - A round ends after twice as many events as slabs were ever in use at once. An event is a slab taken or kept, or an allocation that leaves `lerta_mem_alloc`'s own part.
  - As many slabs as are in use, or 4, whichever is more, are not discarded.
  - So a program keeps empty for long no more memory than it uses, while one that makes and drops a structure over and over discards nothing for it.
  - The rounds are counted in slabs, not in time, so that the same program discards the same slabs on every run.
- The empty slabs are listed in a region of their own, so that a discarded slab holds nothing that the allocator needs.

#### Use-after-drop checking

- The debug runtime keeps a prefix before each object (`LertaPrefix` in `runtime/internal.h`), and sets the object's count to 0 as it frees it.
- The allocator keeps a free place's first 8 bytes at 0, and its free-list link next, both within the prefix, so that the count stays 0 while the place is free.
- So a retain or release of a dropped object, or of one queued to be dropped, which one release too many in the generated code leads to, finds the count at 0, and the debug runtime stops the program.
- **Reuse order.**
  - A release build reuses the place freed last, which is warm in the cache.
  - A debug build hands out the part of a slab never used before any freed place, then the place freed first; it keeps its last 4 empty slabs without reusing them, and unmaps those before. So a place stays free, and a misuse is caught, as long as possible.
- Not caught: a misuse of an object whose place has been reused, and reads other than a retain or release. A misuse in a region returned to the system, as that of an object larger than 16 KiB is at once, faults, unless the system has mapped the region again.

### Alias analysis

- The generated code tags some loads and stores with the metadata of clang's type-based alias analysis (`compiler/codegen/alias_tags.lerta`), so that LLVM knows that writing one kind of memory leaves another as it was, and keeps reads of it out of a loop.
- Each kind is a type of its own under clang's `omnipotent char`, in the tree of the runtime's C types, which is compiled with them under link-time optimization:
  - the items of arrays and the values of maps: the runtime's C moves them only by `memcpy`, never as a C type, so writing one leaves an array's length and items pointer, which the C reads as an integer and a pointer, as they were;
  - the `Float` and `Float32` fields of classes and structs;
  - top-level values and the flags that tell that they are set;
  - the read of the pending exception, tagged as the C pointer clang tags it as (`any pointer`).
- Other accesses are untagged, which LLVM takes as touching anything.
- A kind stays sound as long as no access to its memory names another kind's tag: only the generated code reaches fields and top-level values, and only through tagged or untagged accesses of their own kind.
- So writing the `Float` fields of `bodies[j]` in `bench/nbody` lets LLVM read the top-level `bodies`, its flag and the pending exception once before the loop.

## Representation

### Objects

#### Classes and structs

- A class or struct object is a heap object: the header, then its fields in declaration order, each in its IR type, and, for a class, the pointer to its [weak box](#weak-references).
- An anonymous struct is a heap object like a struct, with its fields in name order; so is a tuple, with its items in order. Each structural type has its own LLVM type and type of objects, generated where it is first used.
- Methods are functions that take the object first.

#### Construction

- Each type has a generated constructor function, which, unlike any other call, takes its arguments owned. So a new value given to it, as `Node(left: make())`, is stored without a retain and a release; a local's value is retained before the call.
- It stores the arguments given first, so that the fields own them before an initializer or `init` can throw. An initializer, reading only the fields before it, cannot see the difference. Then it computes the initialized fields.
- **A constructor that throws** (see [the reference](reference/objects.md#a-construction-that-throws)): when its initializers or `init` throw, it releases the fields, which start as nil, and calls the runtime's `lerta_free_unfinished`, which:
  - drops what that queued (as in a constructor that a `deinit` calls, during a drop);
  - stops the program if the count is not 1, since `init` let the object escape;
  - otherwise detaches the weak box and frees the object without running its `deinit`.

#### Drop and deinit

- The generated type's drop function releases the references the fields hold.
- For a class with `deinit`, it first runs it through the runtime's `lerta_run_deinit`, which:
  - sets the object's count to 1 while `deinit` runs, so that passing `@` on and releasing it does not drop it again;
  - drops at once what `deinit` released, which is otherwise queued until the drop ends;
  - stops the program if the count is not back to 1, since `deinit` then kept the object.

#### Closures

- A function value is a closure: a heap object with the header, the pointer to its code, then its captured values.
- The code takes the closure first, then the arguments, borrowed as in any call.
- A function literal's closure is allocated where the literal is evaluated, with the captured values copied in (references retained), and a generated type whose drop function releases those that are references.
- **Immortal closures.**
  - A closure that captures nothing, such as that of a top-level function, is an immortal constant. Its code is a generated thunk that calls the function without the closure.
  - The closure of a literal declared as a local that is only ever called in its own function (`escaping_locals` in the checker's facts) is on the stack, immortal too, unless it yields or awaits (the call's Iter or Promise would hold it) or captures weakly. It borrows what it captures, which outlives it, and LLVM, which sees its code, calls it directly.
- A method, a C function or a generic function used as a function value (see [function values](reference/functions.md#function-values)) is checked and generated as the function literal that calls it, with parameters of names that the source cannot write, which the checker puts in its place (`compiler/checker/function_references.lerta`, `NodeFacts.replacements`).
- The heap cell of a captured `var` (see [execution model](#execution-model)) is a heap object with the header and the value. Cells of types of the same representation share one layout and type.

#### Unions

- A union value is one pointer, null for nil, to one of:
  - the object of a class, a struct, an array, a map, a tuple or an anonymous struct, whose header's type tells its type;
  - a `String`, whose header's type is null, which no other member's object or box has;
  - a **box** of a value of another member, such as an `Int`, an interface value or a `Binary`, which holds the value's two words (`compiler/codegen/boxes.lerta`). A `Binary` is boxed because its header's type is null too, as it shares a String's representation.
- Every array has one type in its header, `lerta_array_type` of `runtime/array.c`, whatever its items, and every map `lerta_map_type`. So a union holds one array type and one map type at most.
- A box is a heap object of the value, whose type is `linkonce_odr`, named by the value's type, and so the same in every module: a box made in one module is told by another. The types of tuples and anonymous structs are made the same way.
- A `Bool`'s box is one of two immortal ones, `linkonce_odr` too, so that boxing one allocates nothing.
- A value is boxed where it becomes a union's, and taken out where a test, a cast or a `case` narrows it to its member.
- A value converted to an interface member is made an interface value first, through the itab that the checker records for it, as where the interface is expected.
- A method called on a union tests the members in turn and calls that of the member the value is, on the value taken out (`emit_member_dispatch`).
- A `T?`, of one member and nil, stays the pair of a flag and the value (see [nil](#nil)).

### Interfaces

- **The Go approach.** An interface value is a fat pointer, `{ ptr data, ptr itab }`: two pointers (16 bytes on a 64-bit target), whose data is an owned reference.
  - Its optional type has the same representation, nil when the data is null.
  - Arrays and maps hold interface values as 16-byte items (`LertaItemKind` in `runtime/lerta.h`).
- There is no `any`, so the concrete type of a conversion to an interface is known at compile time, and itabs are generated statically.
  - The checker records each conversion's plan: how the type gives each member.
  - Each module defines the itabs it converts with as private constants.
- **The itab** is an array of function pointers, one for each member in order, which take the data, borrowed, and the member's arguments.
  - A method written in Lerta is its own entry.
  - A member given otherwise, by a field, a property, a field that holds a function or a builtin method, has a reader function that reads it, or reads and calls it.
  - Why readers rather than field offsets: a member may be a property of a builtin type, such as `length`, which has no offset, and a single kind of entry keeps the call through an interface one indirect call.
- **A union's itab** is one for the union, whose data is the union's pointer. Each entry is a reader that calls or reads the member of whichever member the value is, as a call on the union does.
- Constrained generics (`T: I`) become direct calls through monomorphization and do not use itabs.
- Cost: a field of a concrete type is 1 load; a member through an interface is 2 loads and an indirect call.

### Builtins

What `std:builtins`, in the files of `std/builtins/`, cannot write in Lerta (see [the reference](reference/builtins.md#methods-of-the-builtin-types)).

#### Built into the compiler

- **Items in place.** The generated code reads and writes the items of arrays, maps and Iters in place, as their types, at the place that the runtime gives once it has checked the index (`lerta_array_checked_items`) or found or placed the key (`lerta_map_find` and `lerta_map_place`), so that no copy of a size known only at run time is made.
  - An item is an integer of fewer than 64 bits, or a `Bool` as a byte, at its own size; two pointers for an interface value; and 8 bytes otherwise. Items are retained by kind (see [memory management](#memory-management)).
  - The operations: `length`, indexing, `push`, `pop`, `remove`, `keys`, `entries`, and the Iter protocol, `has_next` and `next`.
  - Their loads and stores have a type-based alias tag of their own (see [alias analysis](#alias-analysis)).
- `s.binary` passes on the String itself.
- An enum's `to_string` and `to_literal` (since an enum cannot be extended) index a constant array of the members' texts, or of the members as declared, that the compiler generates for the enum, by the value: the member's place among the members, as an `i64`.
- `E.parse` has the runtime's `lerta_enum_parse` compare its argument with each text in turn, allocating nothing.
- A `Float`'s `to_float32` and a `Float32`'s `to_float` are an `fptrunc` and an `fpext`.
- The checker resolves the name of such a method once, to a member of `BuiltinMember` (`compiler/checker/builtins.lerta`). Codegen generates it by a `case` on that member with no `else`, so that a member that codegen does not handle is a compile error.
- **Slices.** An index by a range is no method, so that the program cannot call it by name:
  - `b[start...end]` of a `Binary` is a call of the runtime's `lerta_binary_slice` (`emit_binary_slice`), which copies the bytes at once, as no Lerta code can;
  - `xs[start...end]` of an array is a call of `lerta_array_slice` (`emit_array_slice`), which copies the items at once and retains them by kind, rather than pushing them one by one.
  - A range without a start gives 0, and one without an end the length, which codegen reads. `a..b` gives `b + 1`, or the largest Int itself, which no length reaches, so that the runtime throws.
- **Comparisons.** The builtin `equals` and `hash` of the types that `==` compares, and `compare` of the numbers, are the code of `==`, of the comparisons and of map keys (`compiler/codegen/equality.lerta`).
  - That code calls a class's or struct's own `equals`, `compare` and `hash` (`compiler/codegen/comparison_methods.lerta`).
  - It may run inside the runtime's map functions, so `lerta_check_comparison` makes a panic of an exception that one throws rather than passing it on.
- **Operators.** An operator on a value of a type that it does not apply to otherwise is a call of the type's method, `a + b` of `a.add(b)`.
  - The checker makes the call, types it as any other, and records it by the operation, or by the assignment for `+=` and the like (`operator_calls` in `compiler/checker/shared.lerta`); codegen generates the call instead.
  - The numbers' own `add` and the like are the builtin member `OPERATOR`, which codegen applies by the operator of the method's name.

#### C functions that extends call

- `lerta_binary_text` gives `text` the bytes as the same object if they are valid UTF-8, checking 8 bytes at a time while they are ASCII.
- `lerta_string_slice` gives `split`, `split_once`, the `trim`s and std:scanner the bytes of a String between two characters, as a String too, as it checks that both ends are at a character.
- std:math's `pow`, whose result C checks, as i686 holds what libm returns in an x87 register, wider than a `Float`, until it is stored.
- `print` and `print_error` write with `lerta_print_stdout` and `lerta_print_stderr`, which write at once rather than through the buffer of `stdout` (see [output](#output)).

#### std:json

- The code that writes and reads each type is the compiler's; the rest is Lerta's (`std/json.lerta`, and in `std/internal/` the `JsonWriter`, the `JsonReader` and what they share): its tokens, escapes, the paths of its errors and the objects being written, in the methods of a `JsonWriter` and a `JsonReader`.
- `encode_json` and `decode_json` call `write_json(writer, value)` and `read_json<T>(reader)`, names that only std:json sees. The checker types them by the value's type in the instance (`compiler/checker/json.lerta`), and codegen calls the function of that type (`compiler/codegen/json_write.lerta` and `json_read.lerta`).
- There is one such function per type and module, defined at its first use.
  - It writes or reads a scalar, an enum or an optional value inline by a method: an integer of fewer bits than an `Int` as an `Int`, read in the type's range, and a `Binary` in base64, in Lerta.
  - Other types go through functions of their own, so a type that holds itself is a recursive call.
- The function of a class or struct that may hold itself, through any of its parts, gives the writer the object's address on entering it and leaves it after.
- A field's key is given to the writer's and the reader's methods both as its name is written and in camel case, as the compiler makes it; they take the one of the `JsonKeys` given.
- Reading a union reads the member that the kind of the value tells, by `JsonReader.peek_kind`, whose numbers `json_kind` gives the members.
- Reading an object keeps each field that the constructor takes in a slot with whether its key was given, then calls the constructor with them, as a call does.
- Such a function passes an exception of a method on at once, releasing what it holds, such as an array or the fields partly read, or a map's cursor.

#### Written in Lerta

- `join`, `to_binary`, `repeat` and the integer types' `to_string`, from the first digit, append with `+=`.
- `split` finds its separator with `index_of`, which compares one byte at each place for a separator of one byte, and `occurs_at` at each byte for a longer one.
- A String's `compare` compares bytes. `<` and the like of Strings test its Ordering, through a call of it that the checker makes (`order_calls` in `compiler/checker/shared.lerta`).
- `sqrt` and `remainder` check their arguments before calling libm.
- An array's `to_string` writes the `to_literal` of its items.
- `parse_int` reads bytes with `b[i]`; `contains` reads the map; `values` is a comprehension over `entries`; `iter` of an array or a `Binary` is a comprehension.
- The methods of an extend of `Iterable<T>`, which `Stringable` and `Iterable` are declared beside, are written once for all: `map`, `filter` and `to_array` are comprehensions; `any`, `all` and `find` are `for` loops; `take` and `zip` are Iters written in Lerta.

### Floats

#### Representation

- A `Float` is a `double` and a `Float32` a `float` (`compiler/codegen/float.lerta`). They share their code but for the IR type.
- **Literals.** A literal's text is converted by the runtime's `strtod`, or `strtof` for a `Float32`, which the compiler calls (`lerta_float_literal_bits`, `lerta_float32_literal_bits`). It is written into the IR by its bits in hexadecimal, as LLVM takes a decimal constant only if the double holds it exactly. A `float` constant is written as the `double` of the same value.
  - `strtof` rounds a `Float32`'s text to a `float` at once, as rounding it to a `double` first could round it twice.
- The infinity that std:math names `INFINITY` is made of its bits (`lerta_float_from_bits`), rather than from `1.0 / 0.0`, as std is built by the seed too, whose code throws for that division.
- The comparisons are the ordered ones of `fcmp`.
- A 32-bit x86 target computes with SSE2 (`-msse2 -mfpmath=sse`). The x87, which it uses otherwise, keeps more precision and range than a double, so that a result too large for one would be finite rather than an infinity.
- **In arrays and maps.**
  - Arrays hold a `Float` as an 8-byte item, its bits, and a `Float32` as a 4-byte integer item, its bits.
  - A map holds a `Float` key as the word of an `Int`: the bits of the value, with `-0.0` made `0.0`, so that equal `Float`s are the same key. A `Float` inside a key hashes likewise. A `Float32` key likewise, its bits zero-extended.

#### NaN checks

No `Float` or `Float32` is NaN (see [the reference](reference/types.md)), so arithmetic checks its result for NaN (`fcmp uno`), which needs no magnitude, as a check for an infinity would. Several strategies check fewer results; `--eager-nan-checks` (`ModuleCode.eager_nan_checks`) turns off all of them, so that each operation checks its result where it is.

- **Trees.** A tree of `+ - * /` and negations, of locals, the fields of classes and structs read through them or `@`, literals, and calls that give a float, checks only its root (`float_tree` in `compiler/codegen/operator.lerta`).
  - A NaN in it, which each operation gives for a NaN operand, is a NaN at the root. The error is the same, reported where the tree is rather than where its operation is, after the calls in it, which check their arguments as they are called (`generate_call_in_tree`).
- **Deferred `const`s.** A `const` local whose value is such a tree, unless its ranges (below) show that it gives no NaN, holds it unchecked (`defers_declaration` in `compiler/codegen/function.lerta`), so that a tree that it goes on into checks it once, at its root. This does not apply to a `const` that a function literal captures as a var.
  - It is checked where it is read (`check_where_read`), but as a leaf of a tree whose root checks it; so where its value leaves the arithmetic. A NaN that is never read throws nowhere.
  - A tree whose root its ranges show to give no NaN, which checks nothing, still checks its result where it reads such a local, as the ranges take no local for NaN: once, after the calls in it, as a NaN of any of the locals reaches the root (`reads_unchecked_floats`).
- **Compound assignments.** `x += e`, `-=`, `*=` and `/=` of a `Float` or `Float32` local or field, where `e` is such a tree or a leaf, are a tree too. Its root is the combining operation, whose other operand, the old value read after `e`, is a leaf too. The target keeps its value when it throws.
- **Batches of field writes** (`batched_field_writes`). Such assignments of `Float` or `Float32` fields of a local or `@` that follow one another, with no call in their trees, are a batch, up to one that reads a field of a name that one before it writes (its target's old value too), but not including the last statement of a body.
  - Their values are all computed first, one branch checks them all for NaN, and the stores follow, so that LLVM keeps the writes together, as no check stands between them.
  - Where one is NaN, the branch takes them one by one, each checked and then stored, so that the first that is NaN throws where it is, after the writes before it.

#### Ranges

An operation that would check its result, a tree's root or one of no tree, checks none where the ranges of the body's Floats show that it gives no NaN (`compiler/codegen/float_ranges.lerta`). A root needs this shown with its operands, which check none; an operation of no tree needs it alone, as its operands check theirs. The ranges are found before the body is generated.

- What is known of each Float local: whether it is at least 0 or at most 0, and a bound of its magnitude, computed with the operations' own rounding, which is monotonic, so that the bound holds.
- `x * x` is at least 0.
- A sum gives no NaN where either term is finite or both are of one sign; a product where both are finite; a division where it divides by a constant other than 0.
- A condition that holds narrows by its comparisons with constants, which `and` joins: that of an `if` or a `while`, and the left of `and`, for its right.
  - `e <= c` bounds an `e` of at least 0 by `c`: through a sum of such terms, each of which is at most the sum, and a square, whose root is at most `c + 1`.
- To stay sound simply:
  - only the locals that no function literal captures as vars are followed, so that no call changes them, and not top-level code's own values, which its functions may assign;
  - a loop forgets what it assigns, from its start, and so do an `if`, a `case` and a `try` after them, and a `catch` what its `try` assigned;
  - a `Float32` is not followed, as its operations round in 32 bits, which a bound computed as a double may fall short of.

### Maps

- **Entries.** A map (`LertaMap` in `runtime/lerta.h`, `runtime/map.c`) keeps its entries in an array, in insertion order. Each entry, rounded up to 8 bytes, holds:
  - its key, 8 bytes: a word or a reference, with a narrower integer extended by its sign;
  - its hash;
  - whether it is live;
  - its value, an item of the map's kind.
- **Index.** An open-addressing index, a power of two of slots, each the position of an entry or empty, is probed linearly, with at most half the slots used.
- **Keys.**
  - Integer, `Float`, enum and Bool keys are compared as words; Strings by their bytes; objects by identity; other values, such as structs and arrays, by a hash and an equality function that the compiler generates for the type.
  - All keys but words are retained while the map holds them.
  - Strings and `Binary` values hash by SipHash-1-3, under a key that each process takes at random as it starts, so that keys that collide cannot be computed ahead of time to flood a map. The other hashes go through the splitmix64 finalizer.
- **Sets.** A set is a map whose value type is `void` (`MapType` in `compiler/types.lerta`), with values of no bytes (`LERTA_NO_ITEMS`), so that its entries hold a key, its hash and whether it is live. `Set<T>` names it, and a map pattern of an extend or a generic function does not match it.
- **Removal** marks the entry not live, in place. When the entries are full, they are compacted, unless a cursor of the map is alive (see [Iter](#iter)), and the index is rebuilt with room for twice the entries kept.
- **Defaults.**
  - `m[k, default: d]` finds the key once where it is there (`generate_put_default` in `compiler/codegen/collection.lerta`). Where it is not, it evaluates `d` and places the key, which looks again, as `d` may have changed the map.
  - `+=` and the like on it (`update_with_default` in `compiler/codegen/assignment.lerta`) read the value, or the default, and write the result at the place found, where the key was there, as nothing but the operator runs between the find and the write.
  - A missing key, for which the default ran, is placed anew, and so is any key where `+=` goes through a method of the value's type, which may change the map.

### Strings

- Strings are flat only, for now.
- A `Binary` has the representation of a `String` (`LertaString` in `runtime/lerta.h`) without the UTF-8 guarantee, so `s.binary` and `b.text()` pass the object on.

#### Interpolation

- String interpolation is expanded at compile time into a call of the runtime's variadic function `lerta_string_concat_taken(a, b, ...)`, which takes the parts. (The expansion is internal to the compiler, so programs need no variadic parameters for it.)
- The total length is computed and allocated once.
- The longest part that nothing else holds, and whose place has room for the result, is extended there and its bytes moved to their place, so that it is not copied into a new one. The `to_string` of `"w#{n}"` often has that room in its size class.
- A part without the room is not grown, which would leave the result in a place of twice its size, as `+=` grows a String.
- `lerta_string_concat`, which borrows the parts, copies them all. The runtime's own C calls it, and so does the code that the seed generates.

#### Appending

- `a + b` of a String or a Binary calls `lerta_string_extend`; of a Byte, `lerta_binary_push`; of a Char, `lerta_string_push`, which writes its UTF-8.
- They take `a`: when nothing else holds it, its count being 1, the bytes are appended in place.
- `lerta_grow` keeps the object's place while the allocator's place has room (`lerta_mem_capacity`), and else moves it to one of twice the size, so that a loop of `+=` copies O(n) bytes in all.
  - The move (`move_to_room`) and the copy of a String held elsewhere (`copied`) are functions of their own, so that an append that fits is short enough for LLVM to inline into the generated code.
  - Moving is safe, since a String or a Binary is never held weakly nor thrown, which are what know an object by its place.
- `+=` on a variable or a field evaluates the right side first, then reads the target and passes its reference on, so that the count is 1 if nothing else holds the value, with no retain and release around the right side. On an array item, the array still holds it, so a new one is made.

### FFI

The C types of an extern, and the ownership of its arguments and result, are in [the reference](reference/functions.md#c-functions).

## Iteration and awaiting

### Iter

- A `for` is desugared into the source iterator and a closure for the body. No coroutines are needed.
- **Layout.** An `Iter` is a heap object (`LertaIter` in `runtime/lerta.h`): the header, the pointers to its `has_next` and `next` code, which take the `Iter` itself, a started flag, then the state of its kind.
- **Kinds.** Each is generated once per type it depends on:
  - the items of an array or a `Binary`;
  - the integers of a range;
  - the entries of a map, which a cursor of the runtime (`LertaMapCursor`) reads by their positions, so that the map does not compact them while it is alive;
  - `map` and `filter`, which own their source `Iter` and closure;
  - an Iter written in Lerta, which holds its value as an interface value (see [Iters written in Lerta](reference/types.md#iter));
  - the generator kind: see [functions that yield](#functions-that-yield).
- A lazy comprehension is a `map` of its element's closure over its source, through a `filter` of its guard's closure if it has one. The methods `map` and `filter` are such comprehensions (see [builtins](#builtins)).
- The started flag makes a second traversal throw (see [the reference](reference/types.md#iter)).

#### Devirtualizing the chain

No intermediate data structures are made, but each item goes through calls of code pointers. LLVM turns them into direct calls and inlines them, once the chain is made and consumed in one function:

- **Invariant fields.** What an `Iter` or a closure keeps as it is made is accessed with `!invariant.group` (`fixed` in `HeapField`, which `store_state` refuses to write): its code, the state that its kind never writes again (such as the source and the closure of `map` and `filter`), and a closure's captures (a value or the cell of a var).
- The new object's pointer is laundered (`llvm.launder.invariant.group`), so that LLVM, which cannot otherwise see that the calls in between leave the fields, takes what was written for what is read.
- **Devirtualization rounds.** As each call LLVM inlines makes one more direct, the link of an optimized build lets LLVM optimize a function again up to 8 times where a call becomes direct, rather than 4 (`DEVIRT_ITERATIONS` in `compiler/clang_flags.lerta`), so that a chain of `map` and `filter` over a generator inlines its closures too.
- **One way out.** A comprehension's `Iter` is made before the traversal of its source `Iter` starts, which throws if one has, releasing it then. So a function that gives it, as an Iterable's `map` does, gives what it made on its only way out, which LLVM, once it inlines the function, takes for that very `Iter`.
- A `for` over a call of a function that yields, over a lazy comprehension, or over `map` and `filter` given a function literal, is [fused](#fused-loops) instead; so is a chain of them that a method of an Iterable such as `sum` consumes (see [inlined methods](#inlined-methods)).

### Functions that yield

- A function that yields is generated as two functions (`compiler/codegen/yielding.lerta`, with the coroutine's own parts in `compiler/codegen/coroutine.lerta`):
  - the one that calls reach, which makes an `Iter` of the generator kind and calls the other;
  - its body, as an LLVM coroutine (`presplitcoroutine`, switched-resume lowering), which takes the `Iter` before its arguments.
- LLVM's CoroSplit pass, which clang runs at every optimization level, splits the body into the functions that start, resume and destroy it, and moves the values that live across a suspension into its frame.
- The frame is allocated by `lerta_frame_alloc`, which counts it as a live object for the debug runtime's [leak check](#leak-checking).
- **Arguments** are borrowed for the call only, so the body retains its parameters, `@` and its closure, and holds them in its outermost scope. It then suspends once before its statements, so that the call runs none of them.
- **State.** The `Iter`'s state is the coroutine's handle, a running flag, and a held flag with the item.
  - `yield` stores its value, owned, as the held item and suspends.
  - `has_next` resumes the body unless an item is held or the body is at its final suspension (`llvm.coro.done`); `next` takes the held item.
  - Resuming a running coroutine is undefined in LLVM, so `has_next` throws instead when the running flag is set.
- **Ending.** The end of the body, `return`, and an exception that no `try` in the body takes release its scopes and go to its final suspension.
- **Destroying.** The `Iter`'s drop destroys the coroutine (its handle field is held as `Ownership.COROUTINE`), which takes the destroy branch of the suspension it is at:
  - at a `yield`, it releases the temporaries and scopes held there, as an uncaught exception does, then frees the frame;
  - at the final suspension, it only frees the frame.
  - A `finally` would not run on that way out, which is why `yield` cannot be in a `try` that has one (see [the reference](reference/functions.md)).
- Why LLVM's coroutines rather than a state machine of the compiler's own: the frame, which values live across a suspension (phis and temporaries included), and the splitting are what CoroSplit does. The compiler says only where the body suspends and what it releases when destroyed, which the code for `return` and for exceptions already generates.

### Fused loops

Fusion generates the loop's source in place (`compiler/codegen/fusion.lerta`), so that no `Iter`, closure or coroutine is made and LLVM sees one loop.

#### Over a function that yields

- **When.** A `for` without an index over a call of a top-level function of its own module that yields, is not generic, and is given every argument.
- **Not fused** (called as usual):
  - a function already being generated in place, where the loop is or around the function literal that the loop is in; so a recursive one still makes its `Iter`;
  - one with a `yield` in an expression, in a block of an `if`, a `case` or a `try` that gives a value, where it may hold temporaries as it yields;
  - one where the loop's body would be copied more than 8 times. Each yield generates the body, so a loop with the body in a function taken in place, or in the body of a loop that takes one, copies it as many times as the yields of both.
- **Arguments** are evaluated first, owned, and held until the loop ends.
- **Generation.** The function's body is generated by a generator of its own, which shares the loop's IR and has the facts and the scopes of the function.
  - A `yield` has the loop's generator generate the loop's body with the item, with the function's scopes pushed under it by names that the source cannot write, so that the body finds none of the function's locals.
- **Jumps.**
  - A `break` leaves the function's scopes too (`break_depth` of `Loop`); so do a `return` and an exception out of the loop's body, which go to the loop's own handlers, not to a `catch` of the function.
  - A `continue` goes on after the `yield`.
  - The function's end and its `return` go to the loop's end.
  - An exception that no `try` of the function takes goes on from the loop, as from a call there (`FusedExit`), so that its trace is the same as through the `Iter`.
- **Release order** is innermost first: the loop's locals, then the function's, then the arguments. Where that happens while an object is dropped, as when a function that yields is dropped while it waits in such a loop, the runtime queues what is released and drops it after (see [reference counts](#reference-counts)).

#### Over a lazy comprehension

- **When.** A `for` without an index over a lazy comprehension of no index and no bindings.
- It goes through the comprehension's source itself, its item held under a name that the source cannot write, and for each item generates the guard's function, then the element's, in place, then the loop's body with the element.
- A source that is itself such a comprehension, or a call of a function that yields, is fused in turn.
- Each function is generated with the item as its parameter, by a generator of its own, named as the closure would be in traces.
  - Its scope holds what it captures as the loop's locals, borrowed, so that it reads a var as it changes, as the closure does through its cell.
  - Its `return`, which ends it, and its exception, which goes on from the loop as from the closure's call there, release none of them.
- **Not fused:** a function that is weak, captures weakly, yields or awaits keeps the comprehension's `Iter`, as a coroutine of its own cannot run inside the loop.

#### Over map and filter

- A call of `map` or `filter` of std:builtins over an array or an `Iter`, given a function literal, is gone through as the lazy comprehension that the method is written as:
  - `xs.map(f)` as one whose element is `f`;
  - `xs.filter(keep)` as one whose guard is `keep` and whose element is the item itself.
- Its trace has no site of the method's own closure, which only calls the literal: an exception out of the literal goes on from the loop as from that closure's call there.

#### Deferred locals

- A `:=` local is not declared, and its value is generated at the read instead, as if written there (`defers_to_read`), so that the loop or the method there fuses it in turn, where:
  - its value is one that a loop fuses: a call of a function that yields, a lazy comprehension, or `map` and `filter` given a function literal;
  - the parts of it that are evaluated before its loop could not change in between (see [inlined methods](#inlined-methods));
  - it is read once, in its own scope, as what a loop or a comprehension goes through, or as the object of a method;
  - no function literal captures it;
  - it is not a top-level value, which functions read too.
- The checker finds such reads (`lazy_reads` in its facts). The local's own scope makes what the value reads by name the same at the read.

### Inlined methods

`compiler/codegen/inlined_methods.lerta` generates a method's instance body in place, so that the method's loop goes through the receiver in place and no `Iter` is made.

#### When

- **The method**: one of std:builtins whose body goes through `@` in one `for` without an index, and reads `@` nowhere else, such as `sum`, `fold`, `count`, `any`, `all` and `find` of an Iterable.
- **The receiver**:
  - one that a loop fuses: a call of a function that yields, a lazy comprehension, or `map` and `filter` given a function literal, over such a receiver, a local or a field, or a comprehension over a range;
  - or an array or a `Binary`: a local, a field, or the `Binary` of a `String`.
- **Stable parts.** The receiver is evaluated where the method's loop starts, after the method's arguments, rather than before the call. So the parts of it that are evaluated before its loop, the arguments of a function that yields and a range's bounds, must be values that can neither throw nor change:
  - literals;
  - locals and top-level values whose reads check neither for NaN nor that they are initialized, and that are not vars, which the arguments could assign, nor `Iter`s, which they could traverse;
  - fields of fields, and so on, of such values, which are not `Iter`s or floats either, and the `Binary` of one that is a `String`, where the method is given only such values and function literals, which assign none.

#### Generation

- The method's body is generated by a generator of its own, with the instance's facts and the code of its module, which shares the IR, as a function taken in place is (see [fused loops](#fused-loops)).
- **Arguments** are evaluated first, owned, and held until the body ends. The defaults of those left out are computed by the body's generator.
- **Function literal arguments.** For a parameter that the body only calls (`escaping_locals` in the instance's facts):
  - the literal's closure is on the stack, as that of a local is (see [closures](#closures));
  - each call of the parameter generates the literal in place with its arguments, as a loop takes a lazy comprehension's functions, unless the literal is weak, captures weakly, yields or awaits;
  - the closure is still made, unused, so that what it captures is checked where the literal is.
- A `return` stores the value in a slot and goes to the call's end. An exception that leaves the body goes on from the call, as from a call there.
- **The loop.** The call's generator goes through the method's loop, and the method's generator generates each item's body.
  - Each holds the other's scopes under names that the source cannot write, so that what jumps out of either releases them: the method's scopes while the receiver's code is generated, and those of the receiver's loop while the body is.
  - The body's `break`, `continue` and `return` reach the receiver's labels through a loop that the method's generator gets with their depths.
  - An exception out of the receiver's code goes to a handler of the call's generator, which goes on from the method's loop, as from the calls of the receiver's `Iter` there.
  - The receiver's code adds no site of the call's own (`traceless`), which a call of the method would not add either.

### Functions that await

#### Generation

- A function that awaits is generated as two functions, as one that yields is (`compiler/codegen/awaiting.lerta`):
  - the one that calls reach, which makes the `Promise` (`LertaPromise`, `runtime/async.c`), whose value is stored in place as an array's item is, and calls the body;
  - the body, a coroutine that holds a reference to the `Promise` and gets it before its arguments. It runs at once, so it does not suspend before its statements.
- **`await`** asks the runtime to add the coroutine's handle to the waiters of the promise, which it does only if the promise is pending; the body then suspends.
  - Settling a promise moves its waiters to the ready queue.
  - Once the body is resumed, or if it did not wait, it reads the promise's value, retained, from its slot, or takes its exception, which it throws.
- **Ending.**
  - The end of the body and `return` store the result in the `Promise`'s slot and resolve it.
  - An exception that no `try` in the body takes rejects it, which moves the pending exception into it.
  - The body then releases what it holds and its `Promise`, and frees its frame without a final suspension, so nothing destroys it: it is only ever resumed. A body that waits for a promise that is never settled stays: a leak that the debug runtime reports.
- **Settling without awaiting.** A function that settles its `Promise` without awaiting (`settling` in the checker's facts) is generated as one that awaits, whose body never suspends.
- A function value converted to one that returns a `Promise` of its result is a closure of its own (`emit_settling_closure`), whose code is such a function: it holds the closure it calls, calls it, and settles its `Promise` with the result, or rejects it with the exception.
- **An unhandled rejection.** A `Promise` released while still rejected, its exception never taken, ends the program with that exception's message (see [functions that await](reference/functions.md#functions-that-await)), unless a cancel has gone through it (`cancelled`, below) and the exception is a `CancelledError`, which the type in its header tells, as a type test does.

#### Top-level code

- A module's top-level code that awaits is generated as a function that awaits, without parameters.
- The program's top-level code, the entry module's after that of the modules it imports, is then one too, which awaits each of theirs that awaits.
- `lerta_main` starts it and:
  1. has the runtime watch it (`lerta_watch_top_level`), which ends the program as soon as it is rejected, as the loop may still wait for work that never ends, such as an accept;
  2. runs the loop;
  3. has the runtime check that it is settled (`lerta_finish_top_level`).
- A program whose top-level code awaits nowhere keeps plain functions.

#### The event loop

- `lerta_loop_run` runs at the end of the program's top-level code, before the top-level values are released.
  - It resumes the ready coroutines in the order they became ready, then waits once, on libuv, for what settles promises, such as a sleep's timer or a program's end.
  - It stops when no coroutine is ready and libuv has nothing left to wait for.
- The runtime cannot resume a coroutine itself, as C has no way to call `llvm.coro.resume`, so the generated code passes the loop a function that does.
- **Files.** `runtime/loop.c` holds the loop itself and the thread pool. Each feature that waits uses libuv in its own file, such as `runtime/handle.c` for the network.
  - Why: a backend without libuv replaces the files of the features it has, rather than functions behind a layer of their own that would fit none of them, as on a system without processes or with a network stack of its own.
  - `runtime/output.c` uses libuv's mutex and condition variable too.
- **What waits on the loop:**
  - the sockets of `std:net` (see [network](#network));
  - programs that `run` starts (see [processes](#processes));
  - work on libuv's thread pool (`lerta_loop_work`): the writes out of stdout and stderr (see [output](#output)) and the files (see [files](#files)).
  - stdin is read on a thread of its own (see [stdin](#stdin)).

#### Cancel

- **Links.** `await` gives the runtime the body's own `Promise` too (`lerta_promise_wait_in`), which records the promise it awaits (`awaiting`).
- `lerta_promise_cancel` goes down those links, marking each promise (`cancelled`), to the deepest body, which it marks to throw (`cancel_requested`), then calls the cancel hook of the promise that body awaits, if there is one.
- **Hooks.** What makes a promise of the loop's work registers the hook (`lerta_promise_on_cancel`). The hook:
  - stops the work, such as a sleep's timer, or leaves it to end with no one to settle, such as a read of a file, a write, which libuv cannot stop once started, or a program that `run` started;
  - then rejects the promise with a `CancelledError` (`lerta_promise_reject_cancelled`).
- A pending promise of `std:async`'s `Deferred` is rejected so.
- **Resuming.** The body, resumed, reads its mark on reading the promise (`lerta_promise_result_in`), so one whose promise was settled before its resume throws too.
  - The cancel discards what it overtakes, the value or the exception, and marks the promise as taken, so that a rejection it overtook does not end the program as an unhandled one does; another await of the promise still takes it.
- A cancelled read of stdin cannot stop the thread that reads it: its chunk is kept for the next read, and the async handle is unreferenced meanwhile, so that it does not keep the program running.

## Input and output

### Output

#### The buffer

- The buffer of `stdout` and `stderr` (`runtime/output.c`) is a list of segments, each the bytes of consecutive writes to one stream, so that one buffer keeps the order of both.
- It is written out on a thread of its own, with the same blocking writes as `print`'s.
  - Not through libuv's streams, which would make the file descriptors non-blocking for `print` and for the programs that inherit them.
  - Not on libuv's thread pool, whose few threads long file operations, such as a `read_file` of a FIFO, may hold while `print` and the exit wait.
- The thread starts with the first write out, and tells the loop of each one it has written through a libuv async handle, referenced while a write out has yet to end.
- One write out at most is in flight, with the segments it took from the buffer; writes meanwhile go to a new buffer.
- **Promises.** A write's promise is settled once the count of bytes written out reaches the count written up to it. When a write out ends, on the loop, the promises it reaches are settled, and another starts if a promise waits or the buffer has reached its limit.

#### Synchronous writes

- `print`, `print_error`, `run`, the reports of errors and panics, and the exit write out the buffer synchronously: they wait for a write out in flight, under a mutex and a condition variable that the thread signals, then write the rest themselves.
- `print`, `print_error` and `run` then settle the promises, so that one rejected with nothing to await it may end the program there, before what they would do.
- The ends of the program do not settle them, as settling one may throw while an exception may be pending. Nor do they free what they write out.
- A panic waits for a write out in flight by spinning on an atomic flag rather than by the mutex: a stack overflow panics from a signal handler, which may have interrupted malloc or a wait under the mutex.
- A write out that a synchronous one has taken is not taken again when its callback, which frees it, runs; if the program ends first, it is not freed.
- `print` and `print_error` make one write of the text and the newline, which copies the text into a new String: that copy is cheaper than a second system call.

### Files

- **Thread pool.** `read_file`, `write_file`, `remove_tree` and `copy_file` run the platform's blocking calls on libuv's thread pool, one task each (`runtime/file.c`), and settle their promise on the loop. The task holds the promise and the data until then.
- **Memory.** The worker reads into memory from malloc, and the String is made on the loop, as Lerta's allocator is not thread-safe.
  - The data written is a String or a Binary, which nothing changes, so the worker reads it in place.
- **No panics on a worker**, as a panic touches what only the main thread may: a read that runs out of memory says so, and the loop panics. The platform's small allocations, such as a path converted on Windows, still panic where they are.
- **Errors.** The C functions of files report a failure by their result, false or NULL, or through their promise; `std:io` makes the error of it, so that the messages are written in one place.

#### Open files

- A `File` of `open` writes through an `OpenFile` of `runtime/file.c`, which holds the file. Lerta holds it by its address in a `FileWriter` of `std:io`, whose `deinit` frees it.
- The buffer is the `FileWriter`'s, a `Binary` that `+=` grows in place, written out by a task on the thread pool, one at a time.
- Each write takes the place after the one before it, written at that offset, so that the last one, which the free writes at once, as the program may end before the loop would run it, does not race with one on the thread pool for the file's position.
- An `end` writes the rest on the thread pool, with no promise. The file is closed once it has ended or been freed and the writes on the thread pool have ended.
- A write that fails marks the `OpenFile`, so that every later write and flush fails rather than leave a hole at its place.
- A write's promise has no cancel hook, so a cancelled flush waits for its write before it throws, and the write it holds stays the one that the next flush waits for.

#### stdin

- `stdin` reads a chunk at a time (`lerta_stdin_read`, `runtime/stdin.c`), and its `Reader`, in `std:io`, splits lines and counts of bytes out of the chunk it holds.
- The reads are blocking ones on a thread of their own, which hands each chunk to the loop through a libuv async handle, referenced while a read is pending, as Deno and Go read stdin.
  - Not a libuv stream, which would make descriptor 0 non-blocking for the programs that share its open file: those that `run` starts and those that read it after the program.
  - Not the thread pool, where a read would hold one of its few threads while it waits for input.
- **Closed standard streams.** On POSIX, a closed stdin, stdout or stderr is opened read-only on `/dev/null` at start, before libuv opens descriptors of its own, one of which would otherwise take its descriptor: be read as stdin, or be written by `print` and inherited by the programs that `run` starts. Read-only, a write to stdout or stderr fails as it did on the closed descriptor.

### Processes

- `runtime/process.c` starts a program and waits for its end on the loop.
- It gives the program pipes of the system, made with `uv_pipe`, rather than libuv's own pipes for a program, which are sockets on Unix and which some programs, such as `script`, refuse as their stdin.
- A `Pipe` of `std:io` that becomes a pipe of the system holds the files of its ends, from `lerta_system_pipe`, until a program inherits one, which `std:process` closes then, or this program reads or writes one, through a `Handle` made of it (see [network](#network)).
- `std:process` copies the program's streams, through the `Handle`s of the pipes, from and to what `run` was given, in tasks of their own.

### Network

- **Handles.** A socket or a listener of `std:net` is a `Handle` of `runtime/handle.c`, which holds its libuv stream and the promise that waits on it.
  - Lerta holds it as an `Int`, its address, in a `Handle` of `std/internal/handle.lerta`, a class whose `deinit` frees it, beside the functions that read, write, end and close it; `std:net` makes it.
  - A `Socket` and the function that its `Reader` reads through share the `Handle`, as that function holding the `Socket` would make a cycle; the `Reader` alone keeps it alive too.
  - `accept` and `connect_tcp` take a `Handle` made first, so that no socket is ever only in a promise's value, lost if nothing takes it.
- **Reads.** A read starts libuv's reads and stops them at the first chunk, so a cancelled read stops them with nothing read and lost.
- The libuv stream is unreferenced but while a read or an accept waits on it.
- **Connect.** A connect resolves the host on libuv's thread pool (`uv_getaddrinfo`), and retries with a new libuv stream for each address, as a failed one is not reusable.
- **Close.** A close gives up what waits, which it rejects. The C `Handle` is freed once the Lerta one has freed it and the pending requests, such as writes, and the closes of its libuv streams have ended. A write holds its bytes and the address until it ends.
- **HTTP timeouts.** The timeouts of a connection that `serve` of `std:http` serves, one wait after another, go through a `Deadline` of `std/internal/deadline.lerta` rather than `timeout` of `std:async`, whose sleep and race for each read were a tenth of the server's time.
  - One sleep watches them, until the deadline set, or without end while none is set; a deadline sooner than its wake cancels it to wake then.
  - Over a connection kept alive, it sleeps a few times for each idle timeout, however many requests come meanwhile.
- **SIGPIPE.** On POSIX, SIGPIPE is ignored, as libuv's writes to a socket would raise it on Linux. `lerta_os_write`, which writes stdout and stderr, raises it itself on `EPIPE`, with its default action, so that those still end the program as the signal did (see [std:io](reference/std.md#stdio)). libuv gives the programs that `run` starts the default disposition of each signal.

## Platforms

- Targets are Linux, macOS and **Windows**. No POSIX-specific assumptions from the start: OS dependencies are confined to the boundary of libuv and the runtime.
- How the tests cover other targets, Windows under Wine included, is in the [README](../README.md#building-and-testing).

### Platform functions

- In the runtime, what differs between systems is a small set of functions, declared together in `runtime/internal.h`:
  - `runtime/platform.c` implements those that libuv makes the same on every system, through its synchronous file system calls and its functions of the system.
  - `runtime/platform_posix.c` and `runtime/platform_windows.c` implement the rest, which libuv lacks, or has not synchronously, or not as the runtime needs: the stack and the memory, the standard streams, the arguments, the file of the command of `run`, how the program ends, the system's name (which libuv tells as Linux under Wine), and the copy of a file (libuv's copy removes the file it was replacing if it fails, and copies the size that the file had when it began).
- The compiler compiles `platform_<systems>.c` only for those systems, named as in `third_party/libuv.txt`, so no file of the runtime tests the system with the preprocessor. The rest of the runtime is shared and calls no system functions.

### Windows

- libuv converts paths from and to UTF-8.
- The platform functions use the wide-character (UTF-16) Win32 functions:
  - for the arguments, which they read from the command line (`CommandLineToArgvW`), since the C runtime's `argv` is in the ANSI code page;
  - for the standard streams.
- **`run`** searches only `PATH` for a command without a directory (`SearchPathW`), as POSIX does, and gives libuv the file it finds, since libuv would look first in the directory that the program runs in.
  - libuv quotes the arguments so that the child's C runtime reads them back as they were.
  - libuv reads the environment variables that `run` passes on as WTF-8, so that one that is not valid UTF-16 reaches the child as it was.
- **Standard streams.**
  - stdout and stderr are written with `WriteFile`, so no newline becomes CRLF.
  - To a console, they are written as UTF-16 with `WriteConsoleW`, which shows them whatever the console's code page.
  - stdin is read from a console as UTF-16 with `ReadConsoleW` and given as UTF-8; a line that begins with Ctrl-Z ends it, as `ReadFile` ends it.
  - Neither console path is tested: the tests under Wine write and read through pipes.

### libuv

- The runtime is built with libuv (v1.53.0, `third_party/libuv`), with one line taken out: on Unix, `uv_spawn` that fails while it makes the stdio takes the process handle off the loop's queue (libuv's #4980), though its docs ask for `uv_close` even after a failure, which takes it off again and breaks the queue.
  - A runtime check (`test/runtime/spawn_fails.c`) fails while libuv does so; the line is to stay out of a newer libuv until libuv drops it.
- The compiler carries libuv's sources as it does the runtime's, and compiles them into the runtime's cache for each target, with the flags and the system's libraries that `third_party/libuv.txt` lists for its system, taken from libuv's CMakeLists.txt. Its warnings are silenced, as they are not the program's.
- The runtime's own files take only libuv's headers, which ask nothing more of their users, so that libuv's feature macros, such as `_FILE_OFFSET_BITS`, do not change what the runtime sees.
- Its object files are linked as they are, with no archive: an optimized build drops what the program does not use, through `-flto`, and an unoptimized one holds all of libuv, whose size does not matter there.
- A system's libuv is not used instead:
  - the distributions' packages lag behind (Debian bookworm's is 1.44);
  - none provides one for mingw-w64 off Windows;
  - a shared one would make programs depend on it;
  - it would not make the optimized build faster either (see [inlining the runtime](#inlining-the-runtime)).
- The [event loop](#the-event-loop) runs on it, which absorbs the platform differences of what waits.
