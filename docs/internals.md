# Internals

This describes the implementation design. Unmarked statements describe the compiler as implemented; plans are marked *(planned)* on a heading or **Planned:** on an item.

## Overall architecture

- The compiler writes `.ll` text and has `clang` compile and link it with the runtime.
- **Planned:** LLVM emits objects, and `lld` links them (on all platforms).
- An optimized build lets LLVM inline the runtime's C functions into the generated code, as `lerta_retain`: the runtime is compiled with `-flto`.
- LLVM can inline a function only into one that has the target features it was compiled for. So every function that a build generates has the target's attributes (the CPU and its features) that clang gives a C function compiled with the same flags, which the runtime's cache keeps (`compiler/runtime_cache.lerta`).
- `lerta_release` keeps the dropping of an object out of line, so that the rest is small enough to inline. Inlining it and `lerta_retain` makes the compiler's front end about a quarter faster, and its optimized build about twice as slow, as LLVM then optimizes much more code. Of the compiler's optimized build (15 s on an x86-64 Mac with clang 21, against 1.3 s unoptimized), clang takes 5 s to optimize the program alone and 15 s with the runtime; compiling libuv without `-flto` saves nothing, so libuv takes no measurable part of it.
- The core of the runtime (RC, the representation and basic operations of strings, arrays and maps) is **written in C** and shared by all stages. `runtime/lerta.h` declares what the generated code, std and the C files linked with a program use, and `runtime/internal.h` what only the runtime's own C code does.
  - Builtins and standard modules are written in Lerta where possible (such as `print`). C is limited to the minimal primitives that cannot be written in Lerta (writing to an fd, memory allocation and so on), and the compiler to the operations that need the representation of the builtin types (see [builtins](#builtins)).
- The event loop is in the C core of the runtime, on libuv (see [functions that await](#functions-that-await)). Programs that `run` starts are waited for on it too; **planned:** I/O on it.

### Interface with LLVM (planned)

- The compiler itself (in Lerta) goes as far as producing IR. Beyond that, a **C++ shim** takes over (it exposes a few functions with `extern "C"`).
  - The exposed units are not one-to-one with the LLVM API. They are the operations the compiler needs (output, linking, JIT execution, REPL).
  - The shim receives Lerta objects (`String`, `Array<String>`) directly. LLVM's C++ API uses `StringRef` (pointer + length), so no conversion to NUL-terminated strings is needed.
  - lld is called as a library (through the shim, since it has no C API).
  - LLVM version differences are confined to the shim. The LLVM major version used is fixed.
- How IR is passed:
  1. At first, as `.ll` text (as now). The shim parses it. Easy to debug.
  2. If this is too slow, for example in the REPL, move to a scheme where Lerta builds its own IR objects and passes them in one batch, and the shim builds the LLVM IR.
  - A fine-grained builder that calls an extern per instruction is not adopted (too many externs, and keeping up with versions is heavy).
- The runtime is also linked into the compiler, and during JIT execution its symbols resolve as in-process symbols.

## Bootstrap

- The compiler was first written in TypeScript (stage0), which built its rewrite in Lerta, and has been built by itself since; stage0 is gone. So building it takes a Lerta compiler: the seed, `seed/lerta.ll`. It is the compiler's own LLVM IR, as `dump-llvm` prints it, in seed mode (below). The IR names no target (clang is given it), so the one seed builds on every platform.
- `make` has clang build the seed with the runtime into `build/minilerta`, which builds `compiler/` into `bin/lerta`. Only make and clang are needed. That the seed builds the current source is thus checked by every build.
- The compiler carries the standard modules and the runtime, `std/*.lerta`, `runtime/*.c` and `runtime/*.h`, as the string constants of the generated module `compiler/embedded.lerta`, which git ignores. minilerta builds `tools/embed.lerta`, which writes it from the files that the Makefile lists, so no list of them is written by hand. The loader reads a standard module from it, and `build` writes the runtime from it for clang to compile into [the cache](reference/compiler.md).
- The seed is built in seed mode (`embed --seed`): its `embedded.lerta` holds only the paths, and reads each file when the compiler runs, relative to the current directory, so minilerta must run from the repository's root, as the Makefile runs it. So minilerta builds `bin/lerta` in one step with the working tree's std and runtime, and the seed does not hold them. `make seed` writes such a module into a copy of `compiler/`, in `build/seed-source/`, so that the build's own one stays as it is.
- `make check-bootstrap` has `bin/lerta` build the compiler (stage2), and stage2 build it again (stage3), both with `-Werror`, so the compiler's source has no warnings (minilerta, which builds `bin/lerta`, may predate the option); `bin/lerta` and stage2 must print the same IR for it with `dump-llvm`. Only the IR is compared: the executables differ, since the linker writes a different identifier into each. With `TARGET=<triple>`, stage2 and stage3 are built for that target, so that stage3's IR comes from the compiler running there (the tests do so for 32-bit x86 in Docker, and for Windows under Wine, where stage2 runs a clang for Windows, llvm-mingw's, found on Wine's `PATH`).
- The seed is refreshed only when needed: when the compiler's source is about to use a language feature that the seed compiler lacks. A new function in an existing file of std or of the runtime needs no refresh, since minilerta reads those files from the working tree; a new file does, since the seed holds the list of the paths. The seed need not write the same IR as `bin/lerta`, only build the source, and each refresh stores the seed again in the repository's history. The steps for a new feature:
  1. Implement the feature in a form that the current seed compiler can build, without using it in `compiler/`.
  2. Run `make seed`. It runs `make check-bootstrap` and writes the IR of `bin/lerta`, which has the feature, in seed mode, as the new seed. Then check the new seed with `make clean && make test`, and commit it.
  3. The compiler's source may then use the feature.

## Execution model

- There is no frame chain yet. A closure copies the values that cannot change (`const`s, parameters, loop variables) in (see [objects](#objects)), and each captured `var` lives in a heap cell of its own, which the closure holds.

### Frames and contexts (planned)

The beauty of spaghetti-stack unwinding, at the speed of the machine stack.

- A function's frame is on the machine stack. **Non-RC values (Int, Float, Bool) stay as SSA values** in registers.
- Only variables captured by closures and variables living across `await` are placed in a heap **context object** (the V8 approach). Only the captured variables, not the whole frame.
- For an async function, the context is the coroutine frame itself, which outlives the call that made it; suspended functions are linked by which one awaits which, a spaghetti stack on the heap.
- A **frame record** per function, linked to a global `current_frame` (the LLVM shadow stack approach), which would let a panic print a stack trace, is not needed for exceptions (see below); it may come for stack traces.

### Exceptions

- **Error return values (the Swift approach)**: a throw sets the global pending exception, an interface value of `Error` (there are no threads, so a global is fine), and leaves the function as a `return` does, releasing what its scopes hold. Each call that may throw, of a Lerta function, a closure, an itab's entry or a C function of the runtime, is followed by a check of the pending exception, which leaves the caller so in turn, up to a `try` whose `catch` takes the exception, or to the program's end, which reports it as uncaught.
- An expression that holds an owned value while it evaluates others, as a call holds its arguments, registers it as a temporary, which an exception releases on its way, as it does the scopes it leaves. A `finally` block, whose calls are checked, runs with the exception set aside, and so does a `deinit` that a release runs (`lerta_run_deinit`), which may not throw one of its own.
- The runtime's errors: a C function of the runtime that throws calls `lerta_raise` with the error's kind and message, and returns; the generated code checks the pending exception after each call of such a function. `lerta_raise` calls a function that the compiler generates in `std:builtins`, which constructs the error, of the kind's type there, and sets it as the pending exception; the program registers it first thing. A program that is `std:builtins` or a module it imports, without those types, registers none, and the runtime then stops the program at once. The generated code's own checks, such as for overflow, throw so too, where they fail.
- Why: unwinding reuses the release on `return` and `break`, needs no tables or `longjmp`, and works alike on every platform. A throw across an `await` cannot unwind the machine stack anyway, since the awaiting function's frame is no longer on it: it is carried as the failure of the asynchronous result, which this approach does within synchronous code too. The cost is a load and a branch after each call.
- Considered: a frame chain with `longjmp` (needs a frame record listing the references in every function) and LLVM's zero-cost unwinding (needs landing pads, unwind tables for the runtime's C code, and Windows' SEH apart).

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
- nil is a null pointer for an optional reference, and `{ i1, T }` with a false flag for an optional `Int`, `Byte` or `Bool`.
- For now, every expression of a reference type yields an owned (+1) reference, and its consumer releases it: arguments are borrowed and released by the caller after the call, and a discarded statement value is released at once. An immortal literal is owned for free. The exception is the array or map of an index, or of an assignment to one, when it is named by a local, a top-level value or an import: it is borrowed, since what holds it keeps it for the whole use, so that a loop over an array retains and releases nothing (`generate_borrowed` in `compiler/codegen/expression.lerta`). A `var` is not borrowed, since evaluating the index or the value may reassign it and drop what it held, and nor is a weak local's object, which may go meanwhile.

### Leak checking

- A debug runtime counts live objects (allocations minus releases, excluding immortal static objects).
- At exit, a non-zero count is reported as a leak. **Planned:** the remaining objects are traversed to report cycles (by type).
- Release builds do not count. A build without `-O` uses the debug runtime. The run tests build so, and fail on any leak, as an unexpected line in stderr; so does the bootstrap, which checks stage2's stderr for it.
- An exit through an uncaught `throw` is not checked, since it ends the program in the middle of its work.

### Use-after-drop checking

- A debug runtime keeps the objects that it has dropped last from being freed, with their count at 0, up to 2^20 of them and 16 MiB in all, and stops the program at a retain or release of one, or of one queued to be dropped. One release too many in the generated code leads there sooner or later, where in freed memory it could go unnoticed. An object dropped earlier, and reads other than a retain or release, are not caught. To know the sizes, it writes each object's size before the object, outside its header, whose layout the generated code shares.

## Objects

- A class or struct object is a heap object: the header, then its fields in declaration order, each in its IR type, and for a class, the pointer to its weak box (above). A generated drop function releases the references the fields hold; for a class with `deinit`, it first runs it through the runtime's `lerta_run_deinit`. That sets the object's count to 1 while `deinit` runs, so that passing `@` on and releasing it does not drop it again, drops at once what `deinit` released (which is otherwise queued until the drop ends), and stops the program if the count is not back to 1, since `deinit` then kept the object.
- An anonymous struct is a heap object like a struct, with its fields in name order, and so is a tuple, with its items in order; each structural type has its own LLVM type and drop function, generated where it is first used.
- A function value is a closure: a heap object with the header, the pointer to its code, then its captured values. The code takes the closure first, then the arguments, borrowed as in any call. A function literal's closure is allocated where the literal is evaluated, with the captured values copied in (references retained) and a generated drop function that releases them. A closure that captures nothing, such as that of a top-level function, whose code is a generated thunk that calls the function without the closure, is an immortal constant instead.
- Each type has a generated constructor function, which takes the constructor arguments borrowed, like any call, and computes the initialized fields; methods are functions that take the object first.

## Structs (planned)

- The implementation may copy or share structs, for example inline for small ones and shared via RC for large ones.

## Modules

- Reading a top-level value through a function before it is initialized is detected with an initialized flag, as is reading an imported value of a module of the same import cycle. The check is optimized away where initialization is certain: in the module's own top-level code, and for the values of the modules outside the cycle, which have run.
- The checker checks the modules step by step, each step for all of them before the next, so that the modules of a cycle can use each other's names: their names, then their declarations, their extends (those of the modules of the cycle that run later last), their top-level code in the order it runs, and then the bodies of their functions and the initializers of their fields. An export is worked out when an importer asks for it, and an inferred type on demand, across modules as within one.
- At the end of the program, the top-level values are released in the reverse order of their initialization, so that a `deinit` that runs then can still use those initialized before, as `print` uses `stdout`.

## Builtins

What `std/builtins.lerta` cannot write in Lerta (see [the reference](reference/builtins.md#methods-of-the-builtin-types)):

- **Built into the compiler**: the operations on the representation of arrays, maps and Iters, whose items are one byte for a `Byte` or a `Bool`, two pointers for an interface value and 8 bytes otherwise, and retained by kind (see [memory management](#memory-management)): `length`, indexing, `push`, `pop`, `remove`, `keys`, `entries`, and the Iter protocol, `has_next` and `next`; `s.binary`, which passes on the String itself; an enum's `to_string`, which indexes by the value, the member's place among the members as an `i64`, a constant array of the members' texts that the compiler generates for the enum, which cannot be extended, and `E.parse`, which has the runtime's `lerta_enum_parse` compare its argument with each text in turn, allocating nothing.
- **C functions that extends call**: those that build a String or a Binary, which Lerta has no way to fill byte by byte: `Int.to_string`, which the runtime also needs for its leak report, `join`, `slice` and `to_binary`; the conversions between `Byte` and `Int`; `lerta_binary_as_string`, which gives `text` and `split` their Strings once Lerta knows the bytes are valid UTF-8; and `lerta_binary_find`, with which `split` finds its separator, rather than comparing in Lerta at each byte.
- The rest is Lerta: `print` writes through `stdout`, `parse_int` and the UTF-8 check of `text` read bytes with `b[i]`, `has` reads the map, `values` is a comprehension over `entries`, and `iter` of an array or a `Binary` is a comprehension. The methods of an extend of `Iterable<T>`, which `Stringable` and `Iterable` are declared beside, are written once for all: `map`, `filter` and `to_array` are comprehensions, `any`, `all` and `find` are `for` loops, and `take` and `zip` are Iters written in Lerta.

## Output

- stdout follows the buffering that [the reference](reference/modules.md#stdio) states, as C stdio does, in a buffer of the runtime's own (`runtime/io.c`). The runtime checks for a terminal (`isatty`, or a console on Windows) at start and leaves stdout unbuffered on one, so that each write shows at once. Elsewhere it flushes the buffer before a write that would overflow it and writes one larger than the buffer directly, so that few system calls carry the output.
- `print` makes one write of its text and the newline, which copies the text into a new String in either mode: unbuffered, that copy is cheaper than a second system call; buffered, it adds an allocation and a copy of the text per line, which is small next to producing the text.

## Lazy iterators

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
- **The event loop** (`lerta_loop_run`) runs at the end of the program's top-level code, before the top-level values are released: it resumes the ready coroutines in the order they became ready, then waits once, on libuv, for what settles promises, such as a sleep's timer or a program's end, until no coroutine is ready and libuv has nothing left to wait for. What it waits on is in `runtime/loop.c` alone, the one file of the runtime that uses libuv, so that another backend can replace it. The runtime cannot resume a coroutine itself, as C has no way to call `llvm.coro.resume`, so the generated code passes the loop a function that does.
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

- **Planned:** monomorphized instances are emitted by the using module as `linkonce_odr` and managed by mangled names.
- The compiler compiles the whole program into one LLVM module, so it emits each instance once, with the module that declares the generic function or method, under a symbol made of the function's and the type arguments' names (`lerta.fn.0.print<Int>`), and for a method, of the receiver's too (`lerta.extend.0.Array<T>.map<Int, String>`). An instance checks the function literal with the type parameters standing for its type arguments, and keeps the types and other facts it finds of the literal's nodes apart from those of the other instances; its body sees the extends of its type arguments in effect where it is first called, so instances of the same type arguments that see different extends are told apart by a number after the name.

## Defaults

A function with [defaults](reference/functions.md) takes every argument. For each number of arguments that a call may give, it has an entry, `<symbol>.given<k>`, which computes the defaults of the others and calls it; a call that leaves arguments out calls the entry. The function's value and the itabs refer to the function itself, which a default does not change. A constructor instead takes, after each argument with a [`default`](reference/objects.md), an `i1` of whether it is given, and computes the default in its place among the initializers.

## Floats

- A `Float` is a `double` (`compiler/codegen/float.lerta`). A literal's text is converted by the runtime's `strtod`, which the compiler calls (`lerta_float_literal_bits`), and written into the IR by its bits in hexadecimal, as LLVM takes a decimal constant only if the double holds it exactly.
- No `Float` is infinite or NaN, so arithmetic checks its result: `/` checks its divisor for zero first, and every operation checks that its result's magnitude is below infinity. With no infinity and no NaN to start from, a NaN can come only from `0.0 / 0.0`, which the first check catches. The comparisons are the ordered ones of `fcmp`. A 32-bit x86 target computes with SSE2 (`-msse2 -mfpmath=sse`), as the x87, which it uses otherwise, keeps more precision than a double, so that a result too large for one could pass the check.
- Arrays hold a `Float` as an 8-byte item, its bits. A map holds a `Float` key as the word of an `Int`, the bits of the value with `-0.0` made `0.0`, so that equal `Float`s are the same key, and hashes a `Float` inside a key likewise.

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

- C receives `Int` as `int64_t`, `Byte` as `uint8_t`, and pointers to heap representations such as `LertaString*`. **Planned:** the ABI after small strings become immediate values is undecided.
  - Arguments are borrowed (the C side does not release them). Return values carry ownership (returned with reference count 1).
  - **Planned:** avoid direct access to the representation; use the accessors in the runtime header (`lerta_string_bytes(s, &len)` and so on). This survives changes to the representation. Ropes are flattened here.
- **Planned:** headers are parsed with **libclang** (no custom parser; the same approach as Zig's `@cImport` and Swift's clang importer).
- **Planned:** callbacks, a trampoline from closure to C function pointer. If called from another thread, the call is forwarded to the event loop.

## Platforms

- Targets are Linux / macOS / **Windows**. No POSIX-specific assumptions from the start (OS dependencies are confined to the boundary of libuv and the runtime).
- In the runtime, what differs between systems is a small set of functions, declared together in `runtime/internal.h` and implemented by `platform_posix.c` and `platform_windows.c`. Each file compiles to nothing on the other kind of system, so both are always compiled; the rest of the runtime is shared and calls no system functions.
- Windows uses the wide-character (UTF-16) Win32 functions, converting from and to UTF-8: for paths, for the arguments, which it reads from the command line (`CommandLineToArgvW`), since the C runtime's `argv` is in the ANSI code page, and for the command line of `run`, which quotes each argument so that the child's C runtime reads it back as it was and hands to libuv as it is. `run` searches only `PATH` for a command without a directory (`SearchPathW`), as POSIX does, and gives libuv the file it finds, since libuv would look in the current directory first. stdout and stderr are written with `WriteFile`, so no newline becomes CRLF; to a console, they are written as UTF-16 with `WriteConsoleW`, which shows them whatever the console's code page.
- The tests build Windows programs with mingw-w64 and run them under Wine (`make test-cross`), and run the bootstrap there, with the compiler for Windows building its next stage with a clang for Windows (see [bootstrap](#bootstrap)).
- The runtime is built with libuv (v1.53.0, `third_party/libuv`), whose sources the compiler carries as it does the runtime's, and compiles into the runtime's cache for each target, with the flags and the system's libraries that `third_party/libuv.txt` lists for its system, taken from libuv's CMakeLists.txt; its warnings are silenced, as they are not the program's. The runtime's own files take only libuv's headers, which ask nothing more of their users, so that libuv's feature macros, such as `_FILE_OFFSET_BITS`, do not change what the runtime sees. Its object files are linked as they are, with no archive: an optimized build drops what the program does not use, through `-flto`, and an unoptimized one holds all of libuv, whose size does not matter there. A system's libuv is not used instead: the distributions' packages lag behind (Debian bookworm's is 1.44), none provides one for mingw-w64 off Windows, and a shared one would make programs depend on it; it would not make the optimized build faster either (see [the overall architecture](#overall-architecture)). The event loop runs on it, which absorbs the platform differences of what waits (see [functions that await](#functions-that-await)).
- **Future target: microcontrollers** (STM32 / Cortex-M, ESP32-C3/C6 / RISC-V; Xtensa-based chips after upstream LLVM support matures).
  - `Int` stays fixed at 64 bits (TinyGo's environment-dependent `int` is not adopted). Hot spots use `Int32` explicitly.
  - The event loop is not tied to libuv; **the backend is replaceable** (libuv on PCs; an interrupt-driven scheduler or FreeRTOS/Zephyr on microcontrollers), behind the functions of `runtime/loop.c` (see [functions that await](#functions-that-await)).
  - The runtime C code **does not depend on libc** (only about malloc / memcpy). The allocator is replaceable (TLSF and so on).
  - Beware of code bloat from monomorphization. Remedies when needed: merging instances with identical machine code at link time (LLVM mergefunc, lld ICF), and a build option to switch to dispatch through interfaces.
