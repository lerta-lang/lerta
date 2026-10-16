# Internals

This describes the implementation design. Unmarked statements describe the compiler as implemented; plans are marked *(planned)* on a heading or **Planned:** on an item.

## Overall architecture

- The compiler writes `.ll` text, a file for each module (see [per-module output](#per-module-output)), and has `clang` compile and link it with the runtime.
- An optimized build lets LLVM inline the runtime's C functions into the generated code, as `lerta_retain`: the runtime takes part in the link-time optimization of the modules (see [per-module output](#per-module-output)).
- LLVM can inline a function only into one that has the target features it was compiled for. So every function that a build generates has the target's attributes (the CPU and its features) that clang gives a C function compiled with the same flags, which the runtime's cache keeps (`compiler/runtime_cache.lerta`).
- `lerta_release` keeps the dropping of an object out of line, so that the rest is small enough to inline. Inlining it and `lerta_retain` makes the compiler's front end about a quarter faster, and its optimized build about twice as slow, as LLVM then optimizes much more code.
- The event loop is in the C core of the runtime (see [the event loop](#functions-that-await)).
- The checker records what each member, `x.name`, refers to, where it resolves it (`NodeFacts.members`, of the targets in `compiler/checker/member_targets.lerta`): a field or a builtin property, a method with its source, a property of an interface value or an enum's `parse`. Codegen generates a member by its target and looks nothing up again; an itab's entries hold the targets of the type's members alike.

### Interface with LLVM (planned)

For the planned [object output and linking with lld](roadmap/programs.md#tools):

- The compiler itself (in Lerta) goes as far as producing IR. Beyond that, a **C++ shim** takes over (it exposes a few functions with `extern "C"`).
  - The exposed units are not one-to-one with the LLVM API. They are the operations the compiler needs (output, linking, JIT execution, REPL).
  - The shim receives Lerta objects (`String`, `String[]`) directly. LLVM's C++ API uses `StringRef` (pointer + length), so no conversion to NUL-terminated strings is needed.
  - lld is called as a library (through the shim, since it has no C API).
  - LLVM version differences are confined to the shim. The LLVM major version used is fixed.
- How IR is passed:
  1. At first, as `.ll` text (as now). The shim parses it. Easy to debug.
  2. If this is too slow, for example in the REPL, move to a scheme where Lerta builds its own IR objects and passes them in one batch, and the shim builds the LLVM IR.
  - A fine-grained builder that calls an extern per instruction is not adopted (too many externs, and keeping up with versions is heavy).
- The runtime is also linked into the compiler, and during JIT execution its symbols resolve as in-process symbols.

### Per-module output

- The front end checks and generates the whole program at once, but `build` writes one LLVM module per Lerta module (`compiler/codegen/ir_linking.lerta`), which clang compiles at once, each in a process of its own, and links, so that an optimized build optimizes the modules in parallel, with ThinLTO (`-flto=thin`), which imports into each module the functions of the others that it inlines, the runtime's among them. One large module would be optimized on one thread, and would gain little over full LTO.
- Each module names its `source_filename`, since clang would give it the path of its `.ll`, in the build's temporary directory, which would make each build's objects new to [the ThinLTO cache](reference/compiler.md#cache).
- For that, a module's IR depends only on the module and the declarations it uses:
  - Symbols are named after the module's path and the declaration (see [modules](#modules)), not numbered across the program, so that adding or removing a module renames nothing in the others. What a module makes on demand, such as its function literals, constants, itabs and equality functions, is numbered within it.
  - What a module numbers of its own is private; the rest is external, and a module declares what it uses of the others. It also defines the named types of the others that it uses, the layouts of their classes and structs. What a module uses is found in its text, by the names after `@` and `%"`, so the code that generates it does not list them.
  - Generic instances are emitted by the modules that use them (see [generics](#generics)), so that a module's IR does not depend on those that the others use.
  - A module's top-level code is a function of its own; `lerta_main`, the entry module's, calls the others' in the order of initialization.
- `dump-llvm` prints the modules as one, which declares nothing of its own, so that the seed is one `.ll`, and `make test-bootstrap` compares one.
- The compiler's optimized build, on an x86-64 Mac with clang 21: 15 s with full LTO of one module; with ThinLTO, 2.7 s, 1.9 s after a change to one module, and 1.3 s with nothing changed, besides 3.7 s to compile the runtime once; 1.2 s unoptimized. On x86-64 Linux in Docker, with clang 19: 22 s with full LTO, and 2.8 s with ThinLTO, 1.1 s with nothing changed. The benchmarks run as fast as with full LTO, but on the Mac `fib`, whose recursion is a third slower there for the code's layout, as the code is the same but for one register saved.

## Runtime rules

- The core of the runtime (RC, the representation and basic operations of strings, arrays and maps) is **written in C** and shared by all stages. `runtime/lerta.h` declares what the generated code, std and the C files linked with a program use, and `runtime/internal.h` what only the runtime's own C code does.
  - Builtins and standard modules are written in Lerta where possible (such as `print`). C is limited to the minimal primitives that cannot be written in Lerta (writing to an fd, memory allocation and so on), and the compiler to the operations that need the representation of the builtin types (see [builtins](#builtins)).
- Objects, and the buffers that they own, come from the runtime's allocator, and only the runtime's own buffers from `malloc` (see [allocation](#allocation)).
- What differs between systems is in the platform functions alone (see [platforms](#platforms)); the rest of the runtime calls no system functions, but libuv's in `runtime/loop.c`, and uses of the C library only its memory, string, number and sorting functions.
- There are no threads, so counts are not atomic (see [memory management](#memory-management)) and the pending exception is a global (see [exceptions](#exceptions)).

## Bootstrap

- The compiler was first written in TypeScript (stage0), which built its rewrite in Lerta, and has been built by itself since; stage0 is gone. So building it takes a Lerta compiler: the seed, `seed/lerta.ll`. It is the LLVM IR of `compiler/minilerta.lerta`, the compiler with no more than it needs to bootstrap, as `dump-llvm` prints it in seed mode (below). The IR names no target (clang is given it), so the one seed builds on every platform.
- Given a source, minilerta prints its IR, as `dump-llvm` does. `make` has clang build the seed with the debug runtime into `build/minilerta`. minilerta prints the IR of `compiler/`, which clang builds the same way into `build/stage1`; stage1 builds `bin/lerta`, optimized. Only make and clang are needed. That the seed builds the current source is thus checked by every build.
- The compiler carries the standard modules and the runtime, `std/*.lerta`, `runtime/*.c` and `runtime/*.h`, as the string constants of the generated module `build/embedded.lerta`. clang builds `tools/embed.lerta` from minilerta's IR, and it writes the module from the files that the Makefile lists, so no list of them is written by hand. The loader reads a standard module from it, and `build` writes the runtime from it for clang to compile into [the cache](reference/compiler.md#cache).
- The seed is built in seed mode (`embed --seed`): its `embedded.lerta` holds only the paths, and reads each file when the compiler runs, relative to the current directory, so minilerta must run from the repository's root, as the Makefile runs it. So stage1 is built with the working tree's std and runtime, and the seed does not hold them. `make seed` writes such a module beside a copy of `compiler/`, in `build/seed/`, so that the build's own one stays as it is.
- `make test-bootstrap` has `bin/lerta` build the compiler (stage2), and stage2 build it again (stage3), both with `-Werror`, as stage1 builds `bin/lerta`, so the compiler's source has no warnings; `bin/lerta` and stage2 must print the same IR for it with `dump-llvm`. `bin/lerta` builds `compiler/minilerta.lerta` too, which nothing else builds until `make seed`, for the host, and it must print that IR too. Only the IR is compared: the executables differ, since the linker writes a different identifier into each. With `TARGET=<triple>`, stage2 and stage3 are built for that target, so that stage3's IR comes from the compiler running there (the tests do so for 32-bit x86 in Docker, and for Windows under Wine, where stage2 runs a clang for Windows, llvm-mingw's, found on Wine's `PATH`).
- The seed is refreshed only when needed: when the compiler's source is about to use a language feature that the seed compiler lacks. A new function in an existing file of std or of the runtime needs no refresh, since minilerta reads those files from the working tree; a new file does, since the seed holds the list of the paths. The seed need not write the same IR as `bin/lerta`, only build the source, and each refresh stores the seed again in the repository's history. The steps for a new feature:
  1. Implement the feature in a form that the current seed compiler can build, without using it in `compiler/`.
  2. Run `make seed`. It runs `make test-bootstrap` and writes the IR that `bin/lerta`, which has the feature, generates for `compiler/minilerta.lerta` in seed mode, as the new seed. Then check the new seed with `make clean && make test`, and commit it.
  3. The compiler's source may then use the feature.
- The seed's IR, and so minilerta's, is for LLVM before 23, whose `llvm.coro.end` returns an `i1`, which the IR drops. For a clang whose LLVM declares it `void`, which the Makefile finds by compiling a call of it, the Makefile rewrites the declaration and the calls in that IR before clang builds it (`build/host_llvm.sed`).

## Execution model

- There is no frame chain yet. A closure copies the values that cannot change (`const`s, parameters, loop variables) in (see [objects](#objects)), and each captured `var` lives in a heap cell of its own, which the closure holds.

### Frames and contexts (planned)

The beauty of spaghetti-stack unwinding, at the speed of the machine stack.

- A function's frame is on the machine stack. **Non-RC values (Int, Float, Bool) stay as SSA values** in registers.
- Only variables captured by closures and variables living across `await` are placed in a heap **context object** (the V8 approach). Only the captured variables, not the whole frame.
- For an async function, the context is the coroutine frame itself, which outlives the call that made it; suspended functions are linked by which one awaits which, a spaghetti stack on the heap.
- A **frame record** per function, linked to a global `current_frame` (the LLVM shadow stack approach), which would let a panic print a stack trace, is not needed for exceptions, whose traces are made as they unwind (see below); it may come for the traces of panics.

### Exceptions

- **Error return values (the Swift approach)**: a throw sets the global pending exception, an interface value of `Error` (there are no threads, so a global is fine), and leaves the function as a `return` does, releasing what its scopes hold. Each call that may throw, of a Lerta function, a closure, an itab's entry or a C function of the runtime, is followed by a check of the pending exception, which leaves the caller so in turn, up to a `try` whose `catch` takes the exception, or to the program's end, which reports it as uncaught.
- An expression that holds an owned value while it evaluates others, as a call holds its arguments, registers it as a temporary, which an exception releases on its way, as it does the scopes it leaves. A `finally` block, whose calls are checked, runs with the exception set aside, and so does a `deinit` that a release runs (`lerta_run_deinit`), which may not throw one of its own.
- A `return`, `break` or `continue` that leaves a `try` generates a copy of its `finally` block where it jumps, as the code right after the `try` would run it: the scopes inside the `try` released, and an exception that it throws going to the `try`s outside. A `finally` block is so generated once for each jump out of its `try`, besides its ends; a jump through a shared copy would need to tell where to go on after it, which the copies need not.
- The runtime's errors: a C function of the runtime that throws calls `lerta_raise` with the error's kind and message, and returns; the generated code checks the pending exception after each call of such a function. `lerta_raise` calls a function that the compiler generates in `std:builtins`, which constructs the error, of the kind's type there, and sets it as the pending exception; the program registers it first thing. A program that is `std:builtins` or a module it imports, without those types, registers none, and the runtime then stops the program at once. The generated code's own checks, such as for overflow, throw so too, where they fail.
- Why: unwinding reuses the release on `return` and `break`, needs no tables or `longjmp`, and works alike on every platform. A throw across an `await` cannot unwind the machine stack anyway, since the awaiting function's frame is no longer on it: it is carried as the failure of the asynchronous result, which this approach does within synchronous code too. The cost is a load and a branch after each call.
- Considered: a frame chain with `longjmp` (needs a frame record listing the references in every function) and LLVM's zero-cost unwinding (needs landing pads, unwind tables for the runtime's C code, and Windows' SEH apart).

### Exception traces

- The trace is made as the exception unwinds, so that it costs nothing until one is thrown. Where the generated code throws, or finds that a call has thrown, it calls `lerta_trace_push` with its **site**, a constant of the function's name, the module's file and the position of the innermost statement or expression (`Generator.position`); code that is no function of the program, as an Iter's `has_next`, adds none. A function that the exception leaves adds one entry, at the check of the call that threw, and so does an `await`, whose check is that of the promise's result. A runtime error is thrown by the C function that the code calls, so the call's check is its site.
- The runtime keeps one trace, of the pending exception (`runtime/lerta.c`): its **owner**, the exception's data, and the sites pushed. A `throw` and a runtime error start a new trace (`lerta_trace_start`), but a `throw` of a catch's name, which the codegen tells by its local (`SlotLocal.caught`): that one pushes, as a call's check does (`lerta_trace_push`), which goes on with the trace if it is still the exception's own, and else starts one. Catching an exception does nothing to the trace, which an exception thrown and caught in the catch replaces. An object freed is the owner of none (`lerta_trace_forget`, as it is freed), so that an exception made at its place does not take its trace.
- Where an exception is set aside while code that may throw and catch others runs, its trace is saved and restored with it: around a `finally` block, where the saved copy is a temporary (`Ownership.TRACE`) that an exception leaving the block frees; around a `deinit` (`lerta_run_deinit`); and in a rejected Promise, which keeps a copy for each `await` of it, and for the report of an exception that nothing awaited. Copies are `malloc`ed, as the runtime's own buffers are.
- The trace keeps the first 32 sites pushed and the last 32 in a ring, so that it takes a fixed room however deep the exception comes from.
- Each check that unwinds calls `lerta_trace_push`, which is kept out of line, so that LTO does not copy it into every site: the sites' code is one call with one argument. They make the compiler's own executable some 15% larger; `--no-trace` leaves them out.

### Stack overflow

- The runtime relies on the guard page below the stack: touching it raises SIGSEGV (or SIGBUS), whose handler, on a stack of its own (`sigaltstack`), panics if the faulting address is in the stack's range, which a stack without a limit, or with one beyond the address space, does not have. It costs nothing per call. Other faults keep their default action.
- Windows raises `EXCEPTION_STACK_OVERFLOW` in the overflowing thread, on what is left of its stack. A vectored exception handler panics on it; `SetThreadStackGuarantee` keeps 64 KiB of the stack for the handler, which writes the message and ends the process with `TerminateProcess` (exit code 3, as C's `abort` gives there), since the code that `ExitProcess` runs may need more. Other exceptions go on to the handlers after it.
- **Planned:** where there is no guard page, as on microcontrollers, or if stack overflow becomes an exception that can be caught, the remaining stack is checked at function entry instead (the Go approach); catching it then works like any throw, since the handler runs after unwinding.

## Memory management

- **No threads, so counts are non-atomic.**
- An object whose count reaches zero is queued, and a loop drops and frees the queued objects; dropping one may queue more. This keeps the stack flat when a long chain, such as a linked list, is released.
- A weak field or local holds a weak box of its object instead of the object (`lerta_weak_box` in `runtime/memory.c`), or null for nil: a heap object that points at the object, which one box serves for every weak field and local of it. A function literal that captures a weak local holds the box, and so does a weak function literal for `@`: at each call it takes the object from the box, or returns at once if it is gone, and holds it in its outermost scope. A class's object keeps a pointer to its box after its fields. The two pointers are not counted: the object's drop function first clears the box's pointer, and the box's clears the object's, so that the object is freed as soon as nothing else holds it, and the box once nothing holds it.
- Every heap object starts with a header: its reference count and a drop function, which releases what the object owns before it is freed (`runtime/lerta.h`).
- Static objects such as string literals are made immortal (exempt from count operations).
- nil is a null pointer for an optional reference, and `{ i1, T }` with a false flag for an optional `Int`, `Float`, `Byte`, `Bool` or enum value, whose `T` is unspecified, as in one that comes from C, so it is read only where the flag is set.
- For now, every expression of a reference type yields an owned (+1) reference, and its consumer releases it: arguments are borrowed and released by the caller after the call, and a discarded statement value is released at once. An immortal literal is owned for free. The exception is the array or map of an index, or of an assignment to one, when it is named by a local, a top-level value or an import: it is borrowed, since what holds it keeps it for the whole use, so that a loop over an array retains and releases nothing (`generate_borrowed` in `compiler/codegen/expression.lerta`). A `var` is not borrowed, since evaluating the index or the value may reassign it and drop what it held, and nor is a weak local's object, which may go meanwhile.

### Leak checking

- A debug runtime counts live objects (allocations minus releases, excluding immortal static objects).
- At exit, a non-zero count is reported as a leak (see [the reference](reference/compiler.md#build)); a report of the cycles is [planned](roadmap/runtime.md#memory-management).
- Release builds do not count. A build without `-O` uses the debug runtime. The run tests build so, and fail on any leak, as an unexpected line in stderr; so does the bootstrap, which checks stage2's stderr for it.

### Allocation

- Objects, the buffers that they own, as an array's items, and the frames of coroutines are allocated by the runtime's own allocator (`lerta_mem_alloc`, `lerta_mem_realloc` and `lerta_mem_free` in `runtime/allocator.c`). The runtime's own buffers, which a program does not make often, stay with `malloc`:
  - its queues, as of what is to be dropped, which grow seldom;
  - what it hands to libuv, as the output of a program that it runs;
  - what it holds for a system call, as a path as a C string, some of which the C library gives, as `realpath` and `strdup` do, and must go back to `free`.

  libuv keeps `malloc` too, since its thread pool may allocate, which the allocator, without locks, does not allow.
- `lerta_mem_realloc` keeps the place while it holds the new size and is not more than twice as large, and else moves what it holds to a new one, so that growing an array copies its items at each step beyond its place, as `realloc` does unless it can grow in place. A frame's size is rounded up to a multiple of 16, whose places are aligned to 16 bytes, as malloc aligns what it gives.
- **Regions.** All it hands out lies in a region from the system, aligned to 64 KiB, so that the region of anything allocated is its address with the low 16 bits cleared, and freeing needs no size. Regions come from `mmap` on POSIX, which over-allocates and unmaps what lies outside the alignment, and from `VirtualAlloc` on Windows, whose allocations are aligned to 64 KiB, as platform functions (see [platforms](#platforms)), which a microcontroller would replace with a static heap. A region starts with a header that tells what it holds.
- **Size classes.** A region of 64 KiB is a slab of places of one size class: in steps of 8 bytes from 16 up to 256 bytes, since an object is a header and fields of 8 bytes on a 64-bit system and needs no more alignment, which no object of the runtime may need either; above, each range between two powers of 2 split in 4, so that rounding up wastes at most about a fifth, up to 16 KiB. Anything larger takes a region of its own, whose header gives its size.
- **Allocation** takes a place from the free list of the first slab of the size class with room, or else from the part of it never used yet; each class keeps a list of its slabs with room, and a new slab is taken when there is none. **Freeing** puts the place back on its slab's free list, or returns a region of its own to the system. A slab whose last place is freed, unless it is the last of its class with room, is returned to the system, except for 4, kept for reuse by any class, so that a program that makes and drops the same objects over and over does not map and unmap a slab each time. The header of a slab takes room from its places, which, at 16 KiB, leaves a quarter of it unused.
- **Use-after-drop checking.** A free place keeps its first 8 bytes, an object's count, at 0, and holds its free-list link next, where an object's drop is, so that a retain or release of a dropped object, or of one queued to be dropped, which one release too many in the generated code leads to, finds the count at 0, which a debug runtime stops the program for. A release build reuses the place freed last, which is warm in the cache. A debug build hands out the part of a slab never used before any place freed, then the place freed first, and keeps its last 4 empty slabs without reusing them, so that a place stays free, and a misuse caught, as long as possible. A misuse of an object whose place has been reused, and reads other than a retain or release, are not caught; one in a region returned to the system, as that of an object larger than 16 KiB is at once, faults, unless the system has mapped the region again.

## Objects

- A class or struct object is a heap object: the header, then its fields in declaration order, each in its IR type, and for a class, the pointer to its weak box (above). A generated drop function releases the references the fields hold; for a class with `deinit`, it first runs it through the runtime's `lerta_run_deinit`. That sets the object's count to 1 while `deinit` runs, so that passing `@` on and releasing it does not drop it again, drops at once what `deinit` released (which is otherwise queued until the drop ends), and stops the program if the count is not back to 1, since `deinit` then kept the object.
- A constructor whose initializers or `init` throw releases the fields, which start as nil, and calls the runtime's `lerta_free_unfinished`, which drops what that queued (as in a constructor that a `deinit` calls, during a drop), stops the program if the count is not 1, since `init` let the object escape, and otherwise detaches the weak box and frees the object without running its `deinit`.
- An anonymous struct is a heap object like a struct, with its fields in name order, and so is a tuple, with its items in order; each structural type has its own LLVM type and drop function, generated where it is first used.
- A function value is a closure: a heap object with the header, the pointer to its code, then its captured values. The code takes the closure first, then the arguments, borrowed as in any call. A function literal's closure is allocated where the literal is evaluated, with the captured values copied in (references retained) and a generated drop function that releases them. A closure that captures nothing, such as that of a top-level function, whose code is a generated thunk that calls the function without the closure, is an immortal constant instead.
- The heap cell of a captured `var` (see [execution model](#execution-model)) is a heap object with the header and the value; the cells of types of the same representation share one layout and drop function.
- Each type has a generated constructor function, which takes the constructor arguments borrowed, like any call, and computes the initialized fields; methods are functions that take the object first.

## Structs (planned)

- The implementation may copy or share structs, for example inline for small ones and shared via RC for large ones.

## Formatter

`lerta fmt` (`compiler/format/`) prints the syntax tree again, and compares that with the source.

- The printers make a document (`format/doc.lerta`) of texts, line feeds, indentation, and choices between two forms of a part, the first where its first line fits in 100 columns and the second otherwise. A style rule that decides a part marks it, so that a place where the source differs is reported with the rule of the innermost part there.
- What the tree does not keep is read from the source by position (`format/source.lerta`): the spelling of literals, the names of a destructuring, and the keywords before a clause. A text that prints a token carries its position in the source.
- The lexer gives the comments apart from the tokens (`lex`). Laying the document out puts each back by the positions of the texts around it: one on a line of its own before the next text, and one that ends a line at the end of the line of the last text of its source line. A choice whose first form would hold a comment between its texts takes the second. A blank line of the source between two texts comes back where the output starts a line.
- The lines that differ are found by Myers's algorithm (`format/diff.lerta`).

## Modules

- A module's symbols are named by its path from the entry module's directory (absolute if it is on another root, such as another drive), or `std:name` for a standard module, and the entry module by `./` and its file name, which no other path starts with (`lerta.fn.ast.lerta.parse`, `lerta.fn../main.lerta.main`), rather than by its place among the modules, which changes as others are added. Names are quoted in the IR, with the bytes other than printable ASCII, `"` and `\` escaped as in strings.
- Reading a top-level value through a function before it is initialized is detected with an initialized flag, as is reading an imported value of a module of the same import cycle. The check is optimized away where initialization is certain: in top-level code, for the module's own values and those of the modules outside the cycle, which have run. A function always checks, since a `deinit` can run while the values are released at exit, each unset before its release.
- The checker checks the modules step by step, each step for all of them before the next, so that the modules of a cycle can use each other's names: their names, then their declarations, their extends (those of the modules of the cycle that run later last), their top-level code in the order it runs, and then the bodies of their functions and the initializers of their fields. An export is worked out when an importer asks for it, and an inferred type on demand, across modules as within one.
- std relies on [the order](reference/modules.md#exports) in which top-level values are released: `print` uses `stdout` in a `deinit` that runs then.

## Builtins

What `std/builtins.lerta` cannot write in Lerta (see [the reference](reference/builtins.md#methods-of-the-builtin-types)):

- **Built into the compiler**: the operations on the representation of arrays, maps and Iters, whose items are one byte for a `Byte` or a `Bool`, two pointers for an interface value and 8 bytes otherwise, and retained by kind (see [memory management](#memory-management)): `length`, indexing, `push`, `pop`, `remove`, `keys`, `entries`, and the Iter protocol, `has_next` and `next`; `s.binary`, which passes on the String itself; an enum's `to_string`, since an enum cannot be extended, which indexes a constant array of the members' texts that the compiler generates for the enum by the value, the member's place among the members as an `i64`; and `E.parse`, which has the runtime's `lerta_enum_parse` compare its argument with each text in turn, allocating nothing. The checker resolves the name of such a method once, to a member of `BuiltinMember` (`compiler/checker/builtins.lerta`), and codegen generates it by a `case` on that member with no `else`, so that a member that codegen does not handle is a compile error.
- **C functions that extends call**: those that build a String or a Binary, which Lerta has no way to fill byte by byte: `Int.to_string`, which the runtime also needs for its leak report, `join`, `slice` and `to_binary`; the conversions between `Byte` and `Int`; `lerta_binary_as_string`, which gives `text` and `split` their Strings once Lerta knows the bytes are valid UTF-8; and `lerta_binary_find`, with which `split` finds its separator, rather than comparing in Lerta at each byte.
- `std:io`, which `std:builtins` imports, cannot import it back, so it uses no builtin, nor interpolation, which needs `Stringable`, nor `for` over an Iterable other than an array, a `Binary` or an `Iter`, which needs `Iterable`.
- The rest is Lerta: `print` writes through `stdout`, `parse_int` and the UTF-8 check of `text` read bytes with `b[i]`, `has` reads the map, `values` is a comprehension over `entries`, and `iter` of an array or a `Binary` is a comprehension. The methods of an extend of `Iterable<T>`, which `Stringable` and `Iterable` are declared beside, are written once for all: `map`, `filter` and `to_array` are comprehensions, `any`, `all` and `find` are `for` loops, and `take` and `zip` are Iters written in Lerta.

## Output

- stdout follows the buffering that [the reference](reference/modules.md#stdio) states, as C stdio does, in a buffer of the runtime's own (`runtime/io.c`). The runtime checks for a terminal (`isatty`, or a console on Windows) at start and leaves stdout unbuffered on one, so that each write shows at once. Elsewhere it flushes the buffer before a write that would overflow it and writes one larger than the buffer directly, so that few system calls carry the output.
- `print` makes one write of its text and the newline, which copies the text into a new String in either mode: unbuffered, that copy is cheaper than a second system call; buffered, it adds an allocation and a copy of the text per line, which is small next to producing the text.

## Iter

- Desugared into "the source iterator + a closure for the body". No coroutines needed.
- An `Iter` is a heap object: the header, the pointers to its `has_next` and `next` code, which take the `Iter` itself, a started flag, then the state of its kind (`LertaIter` in `runtime/lerta.h`). The kinds are the items of an array or a `Binary`, the integers of a range, the entries of a map, which a cursor of the runtime reads by their positions (`LertaMapCursor`), so that the map does not compact them while it is alive, `map` and `filter`, which own their source `Iter` and closure, an Iter written in Lerta, which holds its value as an interface value (see [Iters written in Lerta](reference/types.md#iter)), and the generator kind of a [function that yields](#functions-that-yield); each is generated once per type it depends on. A lazy comprehension is a `map` of its element's closure over its source, through a `filter` of its guard's closure if it has one; the methods `map` and `filter` are such comprehensions (see [builtins](#builtins)).
- No intermediate data structures are made, but each item goes through calls of code pointers. Fusing a chain into the `for` loop that consumes it is left for later.
- A started flag is kept, and starting a second traversal throws.

## Functions that yield

- A function that yields is generated as two functions (`compiler/codegen/yielding.lerta`, with the coroutine's own parts in `coroutine.lerta`): the one that calls reach, which makes an `Iter` of the generator kind and calls the other, its body, as an LLVM coroutine (`presplitcoroutine`, switched-resume lowering), with the `Iter` before its arguments. LLVM's CoroSplit pass, which clang runs at every optimization level, splits the body into the functions that start, resume and destroy it, and moves the values that live across a suspension into its frame. The frame is allocated by `lerta_frame_alloc`, which counts it as a live object for the debug runtime's leak check.
- The arguments are borrowed for the call only, so the body retains its parameters, `@` and its closure, and holds them in its outermost scope; it then suspends once before its statements, so that the call runs none of them.
- The `Iter`'s state is the coroutine's handle, a running flag, and a held flag with the item. `yield` stores its value, owned, as the held item and suspends. `has_next` resumes the body unless an item is held or the body is at its final suspension (`llvm.coro.done`); `next` takes the held item. Resuming a running coroutine is undefined in LLVM, so `has_next` throws instead when the flag is set.
- The end of the body, `return` and an exception that no `try` in the body takes release its scopes and go to its final suspension. The `Iter`'s drop destroys the coroutine (its handle field is held as `Ownership.COROUTINE`), which takes the destroy branch of the suspension it is at: that of a `yield` releases the temporaries and scopes held there, as an uncaught exception does, then frees the frame; that of the final suspension only frees it. A `finally` would not run on that way out, so `yield` cannot be in a `try` that has one.
- Why LLVM's coroutines rather than a state machine of the compiler's own: the frame, which values live across a suspension (phis and temporaries included), and the splitting are what CoroSplit does; the compiler says only where the body suspends and what it releases when destroyed, which the code for `return` and for exceptions already generates.

## Functions that await

- A function that awaits is generated as two functions, as one that yields is (`compiler/codegen/awaiting.lerta`): the one that calls reach makes the `Promise` (`LertaPromise`, `runtime/async.c`), whose value is stored in place as an item of an array is, and calls the body, a coroutine that holds a reference to the `Promise` and gets it before its arguments. The body runs at once, so it does not suspend before its statements.
- `await` asks the runtime to add the coroutine's handle to the waiters of the promise, which it does only if the promise is pending; the body then suspends. Settling a promise moves its waiters to the ready queue. Once the body is resumed, or if it did not wait, it reads the promise's value, retained, from its slot, or takes its exception, which it throws.
- The end of the body, and `return`, store the result in the `Promise`'s slot and resolve it; an exception that no `try` in the body takes rejects it, which moves the pending exception into it. The body then releases what it holds and its `Promise`, and frees its frame without a final suspension, so nothing destroys it: it is only ever resumed, and a body that waits for a promise that is never settled stays, a leak that the debug runtime reports.
- **The event loop** (`lerta_loop_run`) runs at the end of the program's top-level code, before the top-level values are released: it resumes the ready coroutines in the order they became ready, then waits once, on libuv, for what settles promises, such as a sleep's timer or a program's end, until no coroutine is ready and libuv has nothing left to wait for. What it waits on is in `runtime/loop.c` alone, the one file of the runtime that uses libuv, so that another backend can replace it. Programs that `run` starts are waited for on it too; **planned:** I/O on it ([concurrency](roadmap/runtime.md#concurrency)). The runtime cannot resume a coroutine itself, as C has no way to call `llvm.coro.resume`, so the generated code passes the loop a function that does.
- A `Promise` dropped while rejected, its exception never taken, ends the program with that exception's message, so that no exception is lost.
- A module's top-level code that awaits is generated as a function that awaits, without parameters, and the program's, the entry module's after that of the modules it imports, is then one too, which awaits each of theirs that awaits; `lerta_main` starts it, runs the loop, then has the runtime check that it is settled, and takes its exception (`lerta_finish_top_level`). A program whose top-level code awaits nowhere keeps plain functions.

## Interfaces

- The Go approach: an interface value is a fat pointer, `{ ptr data, ptr itab }`, two pointers (16 bytes on a 64-bit target), whose data is an owned reference. Its optional type has the same representation, nil when the data is null. Arrays and maps hold interface values as 16-byte items (`LertaItemKind` in `runtime/lerta.h`).
- There is no `any`, so the concrete type of a conversion to an interface is known at compile time, and itabs are generated statically. The checker records each conversion's plan, how the type gives each member; each module defines the itabs it converts with as private constants.
- The itab is an array of function pointers, one for each member in order, which take the data, borrowed, and the member's arguments. A method written in Lerta is its own entry. A member given otherwise, by a field, a property, a field that holds a function or a builtin method, has a reader function that reads it, or reads and calls it.
- Why readers rather than field offsets: a member may be a property of a builtin type, such as `length`, which has no offset, and a single kind of entry keeps the call through an interface one indirect call.
- Constrained generics (`T: I`) become direct calls through monomorphization and do not use itabs.
- Cost: concrete-type field = 1 load; member through an interface = 2 loads and an indirect call.

## Generics

- Each module emits the instances that it uses, those that its code names and those that their bodies name in turn, as `linkonce_odr`, so that the linker keeps one of each (see [per-module output](#per-module-output)): the instances of generic functions and methods, and of generic classes and structs, their layouts, constructors and drop functions. An instance's body sees the names of the module that declares the generic one. It is named with a symbol made of the function's and the type arguments' names (`lerta.fn.std:builtins.print<Int>`), and for a method, of the receiver's too (`lerta.extend.std:builtins.Array<T>.map<Int, String>`). An instance checks the function literal with the type parameters standing for its type arguments, and keeps the types and other facts it finds of the literal's nodes apart from those of the other instances; its body sees the extends of its type arguments in effect where it is first called, so instances of the same type arguments that see different extends are told apart by a number after the name.

## Defaults

A function with [defaults](reference/functions.md) takes every argument. For each number of arguments that a call may give, it has an entry, `<symbol>.given<k>`, which computes the defaults of the others and calls it; a call that leaves arguments out calls the entry. The function's value and the itabs refer to the function itself, which a default does not change. A constructor instead takes, after each argument with a [`default`](reference/objects.md), an `i1` of whether it is given, and computes the default in its place among the initializers.

## Floats

- A `Float` is a `double` (`compiler/codegen/float.lerta`). A literal's text is converted by the runtime's `strtod`, which the compiler calls (`lerta_float_literal_bits`), and written into the IR by its bits in hexadecimal, as LLVM takes a decimal constant only if the double holds it exactly.
- No `Float` is infinite or NaN, so arithmetic checks its result: `/` checks its divisor for zero first, and every operation checks that its result's magnitude is below infinity. With no infinity and no NaN to start from, a NaN can come only from `0.0 / 0.0`, which the first check catches. The comparisons are the ordered ones of `fcmp`. A 32-bit x86 target computes with SSE2 (`-msse2 -mfpmath=sse`), as the x87, which it uses otherwise, keeps more precision than a double, so that a result too large for one could pass the check.
- Arrays hold a `Float` as an 8-byte item, its bits. A map holds a `Float` key as the word of an `Int`, the bits of the value with `-0.0` made `0.0`, so that equal `Float`s are the same key, and hashes a `Float` inside a key likewise.

## Maps

- A map (`LertaMap` in `runtime/lerta.h`, `runtime/map.c`) keeps its entries in an array, in insertion order: each its key, 8 bytes, a plain item or a reference, its hash, whether it is live, and its value, an item of the map's kind, the whole rounded up to 8 bytes. An open-addressing index, a power of two of slots, each the position of an entry or empty, is probed linearly, with at most half the slots used.
- Int, Byte and Bool keys are compared as they are, Strings by their bytes, objects by identity, and other values, such as structs and arrays, by a hash and an equality function that the compiler generates for the type; all but Ints, Bytes and Bools are retained while the map holds them. Strings hash by FNV-1a; the other hashes go through the splitmix64 finalizer.
- A set is a map whose value type is `void` (`MapType` in `compiler/types.lerta`), with values of no bytes (`LERTA_NO_ITEMS`), so that its entries hold a key, its hash and whether it is live; `Set<T>` names it, and a map pattern of an extend or a generic function does not match it.
- Removing a key marks its entry not live, in place. When the entries are full, they are compacted, unless a cursor of the map is alive (see [Iter](#iter)), and the index is rebuilt with room for twice the entries kept.

## Strings

- String interpolation is expanded at compile time into a call to the runtime variadic function `lerta_string_concat(a, b, ...)` (this expansion is internal to the compiler, so user-facing variadic parameters are not needed). The total length is computed and allocated once.
- Strings are flat only, for now. A `Binary` has the representation of a `String` (`LertaString` in `runtime/lerta.h`) without the UTF-8 guarantee, so `s.binary` and `b.text()` pass the object on.
- **Planned:** the set of representations (in priority order):
  1. Small strings as immediate values (String is a 16-byte value with 15 bytes inline)
  2. Flat strings
  3. **Ropes** (concatenation kept as a tree)
  4. Slices (`StringSlice`)
- **Planned:** rope rules:
  - Operations that do not flatten: concatenation, length, iteration, output (`writev`), equality comparison.
  - Operations that flatten: byte indexing (`s.binary[i]`), passing to C, hashing (use as a map key).
    - So the O(1) of `s.binary` holds for flat strings. For a rope, the first access costs an O(n) flatten.
  - Flattening replaces the node in place. Implemented with an explicit stack (no recursion).
  - A concatenation with a short result copies immediately without creating a node (equivalent to V8's 13 characters).
  - There is a depth limit. Beyond it, the rope is flattened.

## Regular expressions (planned)

- For literals, the engine's bytecode is embedded in the binary (no parsing at run time). No machine code generation.

## FFI

- The C types of an extern, and the ownership of its arguments and result, are in [the reference](reference/functions.md#c-functions). **Planned:** the ABI after small strings become immediate values is undecided.
  - **Planned:** avoid direct access to the representation; use the accessors in the runtime header (`lerta_string_bytes(s, &len)` and so on). This survives changes to the representation. Ropes are flattened here.
- **Planned:** headers are parsed with **libclang** (no custom parser; the same approach as Zig's `@cImport` and Swift's clang importer).
- **Planned:** callbacks, a trampoline from closure to C function pointer. If called from another thread, the call is forwarded to the event loop.

## Platforms

- Targets are Linux / macOS / **Windows**. No POSIX-specific assumptions from the start (OS dependencies are confined to the boundary of libuv and the runtime).
- In the runtime, what differs between systems is a small set of functions, declared together in `runtime/internal.h` and implemented by `platform_posix.c` and `platform_windows.c`. Each file compiles to nothing on the other kind of system, so both are always compiled; the rest of the runtime is shared and calls no system functions.
- Windows uses the wide-character (UTF-16) Win32 functions, converting from and to UTF-8: for paths, for the arguments, which it reads from the command line (`CommandLineToArgvW`), since the C runtime's `argv` is in the ANSI code page, and for the command line of `run`, which quotes each argument so that the child's C runtime reads it back as it was and hands to libuv as it is. `run` searches only `PATH` for a command without a directory (`SearchPathW`), as POSIX does, and gives libuv the file it finds, since libuv would look in the current directory first. stdout and stderr are written with `WriteFile`, so no newline becomes CRLF; to a console, they are written as UTF-16 with `WriteConsoleW`, which shows them whatever the console's code page.
- How the tests cover other targets, Windows under Wine included, is in the [README](../README.md#building-and-testing).
- The runtime is built with libuv (v1.53.0, `third_party/libuv`), with one line taken out: on Unix, `uv_spawn` that fails while it makes the stdio takes the process handle off the loop's queue (libuv's #4980), though its docs ask for `uv_close` even after a failure, which takes it off again and breaks the queue; a runtime check (`test/runtime.ts`) fails while libuv does so, and the line is to stay out of a newer libuv until libuv drops it. The compiler carries its sources as it does the runtime's, and compiles them into the runtime's cache for each target, with the flags and the system's libraries that `third_party/libuv.txt` lists for its system, taken from libuv's CMakeLists.txt; its warnings are silenced, as they are not the program's. The runtime's own files take only libuv's headers, which ask nothing more of their users, so that libuv's feature macros, such as `_FILE_OFFSET_BITS`, do not change what the runtime sees. Its object files are linked as they are, with no archive: an optimized build drops what the program does not use, through `-flto`, and an unoptimized one holds all of libuv, whose size does not matter there. A system's libuv is not used instead: the distributions' packages lag behind (Debian bookworm's is 1.44), none provides one for mingw-w64 off Windows, and a shared one would make programs depend on it; it would not make the optimized build faster either (see [the overall architecture](#overall-architecture)). The [event loop](#functions-that-await) runs on it, which absorbs the platform differences of what waits.
- **Planned:** microcontrollers as targets (STM32 / Cortex-M, ESP32-C3/C6 / RISC-V; Xtensa-based chips after upstream LLVM support matures).
  - `Int` stays fixed at 64 bits (TinyGo's environment-dependent `int` is not adopted). Hot spots use `Int32` explicitly.
  - The [event loop](#functions-that-await) runs there on an interrupt-driven scheduler or FreeRTOS/Zephyr, behind the functions of `runtime/loop.c`.
  - The platform functions are replaced, as the regions of the allocator are by a static heap (see [allocation](#allocation)); the rest of the runtime needs only what [the runtime rules](#runtime-rules) allow of the C library.
  - Beware of code bloat from monomorphization. Remedies when needed: merging instances with identical machine code at link time (LLVM mergefunc, lld ICF), and a build option to switch to dispatch through interfaces.
