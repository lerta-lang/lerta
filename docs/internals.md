# Internals

This describes the implementation design. Unmarked statements describe stage0 as implemented; plans are marked *(planned)* on a heading or **Planned:** on an item.

## Overall architecture

- stage0 writes `.ll` text and has `clang` compile and link it with the runtime.
- **Planned:** LLVM emits objects, and `lld` links them (on all platforms).
- The core of the runtime (RC, the representation and basic operations of strings, arrays and dictionaries) is **written in C** and shared by all stages.
  - Builtins and standard modules are written in Lerta where possible (such as `print`). C is limited to the minimal primitives that cannot be written in Lerta (writing to an fd, memory allocation and so on), and the compiler to the operations that need the representation of the builtin types (see [builtins](#builtins)).
- **Planned:** an event loop, in the C core of the runtime, on libuv, which I/O uses too.

### Interface with LLVM (planned)

- The compiler itself (in Lerta) goes as far as producing IR. Beyond that, a **C++ shim** takes over (it exposes a few functions with `extern "C"`).
  - The exposed units are not one-to-one with the LLVM API. They are the operations the compiler needs (output, linking, JIT execution, REPL).
  - The shim receives Lerta objects (`String`, `Array<String>`) directly. LLVM's C++ API uses `StringRef` (pointer + length), so no conversion to NUL-terminated strings is needed.
  - lld is called as a library (through the shim, since it has no C API).
  - LLVM version differences are confined to the shim. The LLVM major version used is fixed.
- How IR is passed:
  1. At first, as `.ll` text (same as stage0). The shim parses it. Easy to debug.
  2. If this is too slow, for example in the REPL, move to a scheme where Lerta builds its own IR objects and passes them in one batch, and the shim builds the LLVM IR.
  - A fine-grained builder that calls an extern per instruction is not adopted (too many externs, and keeping up with versions is heavy).
- The runtime is also linked into the compiler, and during JIT execution its symbols resolve as in-process symbols.

## Execution model

- stage0 has no frame chain. A closure copies the values that cannot change (`const`s, parameters, loop variables) in (see [objects](#objects)), and each captured `var` lives in a heap cell of its own, which the closure holds.

### Frame chain (planned)

The beauty of spaghetti-stack unwinding, at the speed of the machine stack.

- At the start of each function, a **frame record** is `alloca`ed (a parent pointer plus slots for locals holding RC references) and linked to the global variable `current_frame` (the LLVM shadow stack approach). There are no threads, so a global variable is fine.
- **Non-RC values (Int, Float, Bool) stay as SSA values** in registers. They are not put in the frame record.
- RC references that are temporaries not living across a function call are not put there either.
- Only variables captured by closures and variables living across `await` are placed in a heap **context object** (the V8 approach). Only the captured variables, not the whole frame.
- For an async function, the context is the coroutine frame itself.
- The cost per function call is a few stores.

### Exception implementation (planned; undecided candidates)

- **Frame chain + `longjmp`**: `throw` walks the chain to find a handler, releasing the RC references in the records along the way, then `longjmp`s. No tables needed; suited to microcontrollers.
- **LLVM zero-cost unwinding (Itanium ABI)**: zero cost on the normal path, throw is heavy. Needs per-platform unwind tables.
- **Error return values (the Swift approach)**: a branch on every call, but no unwinding mechanism needed.

**Planned:** stack overflow is detected by checking the remaining stack at function entry (the Go approach), and it panics.

## Memory management

- **No threads, so counts are non-atomic.**
- An object whose count reaches zero is queued, and a loop drops and frees the queued objects; dropping one may queue more. This keeps the stack flat when a long chain, such as a linked list, is released.
- **Planned:** weak references follow Rust's `Rc` approach (a weak count is kept; while weak references remain, the memory is not returned and only the contents are destroyed).
- Every heap object starts with a header: its reference count and a drop function, which releases what the object owns before it is freed (`runtime/lerta.h`).
- Static objects such as string literals are made immortal (exempt from count operations).
- nil is a null pointer for an optional reference, and `{ i1, T }` with a false flag for an optional `Int`, `Byte` or `Bool`.
- In stage0, every expression of a reference type yields an owned (+1) reference, and its consumer releases it: arguments are borrowed and released by the caller after the call, and a discarded statement value is released at once. An immortal literal is owned for free.

### Leak checking

- A debug runtime counts live objects (allocations minus releases, excluding immortal static objects).
- At exit, a non-zero count is reported as a leak. **Planned:** the remaining objects are traversed to report cycles (by type).
- Release builds do not count. In stage0, a build without `-O` uses the debug runtime.
- An exit through an uncaught `throw` is not checked, since it ends the program in the middle of its work.

## Objects

- A class or struct object is a heap object: the header, then its fields in declaration order, each in its IR type. A generated drop function releases the references the fields hold; for a class with `deinit`, it first runs it through the runtime's `lerta_run_deinit`. That sets the object's count to 1 while `deinit` runs, so that passing `@` on and releasing it does not drop it again, drops at once what `deinit` released (which is otherwise queued until the drop ends), and stops the program if the count is not back to 1, since `deinit` then kept the object.
- An anonymous struct is a heap object like a struct, with its fields in name order; each structural type has its own LLVM type and drop function, generated where it is first used.
- A function value is a closure: a heap object with the header, the pointer to its code, then its captured values. The code takes the closure first, then the arguments, borrowed as in any call. A function literal's closure is allocated where the literal is evaluated, with the captured values copied in (references retained) and a generated drop function that releases them. A closure that captures nothing, such as that of a top-level function, whose code is a generated thunk that calls the function without the closure, is an immortal constant instead.
- Each type has a generated constructor function, which takes the constructor arguments borrowed, like any call, and computes the initialized fields; methods are functions that take the object first.

## Structs (planned)

- The implementation may copy or share structs, for example inline for small ones and shared via RC for large ones.

## Modules

- Reading a top-level value through a function before it is initialized is detected with an initialized flag. The check is optimized away where initialization is certain.
- At the end of the program, the top-level values are released in the reverse order of their initialization, so that a `deinit` that runs then can still use those initialized before, as `print` uses `stdout`.

## Builtins

What `std/builtins.lerta` cannot write in Lerta (see [the reference](reference/builtins.md#methods-of-the-builtin-types)):

- **Built into the compiler**: the operations on the representation of arrays, maps and Iters, whose items are 8 bytes and retained by kind (see [memory management](#memory-management)): `length`, indexing, `push`, `pop`, `remove`, `keys`, and the Iter protocol, `has_next` and `next`; `s.binary`, which passes on the String itself; and `take`, which stops reading its source, which an Iter written in Lerta, a comprehension, cannot. It moves to Lerta once an Iter's `has_next` and `next` can be written in Lerta.
- **C functions that extends call**: those that build a String or a Binary, which Lerta has no way to fill byte by byte: `Int.to_string`, which the runtime also needs for its leak report, `join` and `slice`; the conversion of a `Byte` to an `Int`; and `lerta_binary_as_string`, which gives `decode_utf8` and `split` their Strings once Lerta knows the bytes are valid UTF-8.
- The rest is Lerta: `print` writes through `stdout`, `parse_int`, `split` and the UTF-8 check of `decode_utf8` read bytes with `b[i]`, `has` reads the map, `iter` of an array and `map`, `filter` and `to_array` of an Iter are comprehensions, and `any`, `all` and `find` of an Iter are `for` loops; those of an array go through its `iter`.

## Output

- stdout follows the buffering that [the reference](reference/modules.md#stdio) states, as C stdio does, in a buffer of the runtime's own (`runtime/io.c`). The runtime checks for a terminal with `isatty` at start and leaves stdout unbuffered on one, so that each write shows at once. Elsewhere it flushes the buffer before a write that would overflow it and writes one larger than the buffer directly, so that few system calls carry the output.
- `print` makes one write of its text and the newline, which copies the text into a new String in either mode: unbuffered, that copy is cheaper than a second system call; buffered, it adds an allocation and a copy of the text per line, which is small next to producing the text.

## Lazy iterators

- Desugared into "the source iterator + a closure for the body". No coroutines needed (possible in Phase 0).
- An `Iter` is a heap object: the header, the pointers to its `has_next` and `next` code, which take the `Iter` itself, a started flag, then the state of its kind (`LertaIter` in `runtime/lerta.h`). The kinds are the items of an array or a `Binary` and the integers of a range, and `map`, `filter` and `take`, which own their source `Iter` and closure; each is generated once per type it depends on. A lazy comprehension is a `map` of its element's closure over its source, through a `filter` of its guard's closure if it has one; the methods `map` and `filter` are such comprehensions (see [builtins](#builtins)).
- No intermediate data structures are made, but each item goes through calls of code pointers. Fusing a chain into the `for` loop that consumes it is left for later.
- A started flag is kept, and starting a second traversal throws.

## Interfaces (planned)

- The Go approach: assigning a concrete type to an interface produces a fat pointer (object pointer, itab).
- There is no `any`, so the source concrete type of a conversion to an interface is known at compile time, and itabs are generated statically.
- When an interface method is satisfied by a function-valued field, the itab holds a relay function that "reads the field and calls it".
- Constrained generics (`T: I`) become direct calls through monomorphization and do not use itabs.
- Besides method pointers, the itab holds **field offsets**.
- Cost: concrete-type field = 1 load; field through an interface = 2 loads; method through an interface = indirect call.

## Generics

- **Planned:** monomorphized instances are emitted by the using module as `linkonce_odr` and managed by mangled names.
- stage0 compiles the whole program into one LLVM module, so it emits each instance once, with the module that declares the generic function or method, under a symbol made of the function's and the type arguments' names (`lerta.fn.0.print<Int>`), and for a method, of the receiver's too (`lerta.extend.0.Array<T>.map<Int, String>`). An instance is a copy of the function literal, checked with the type parameters standing for its type arguments; its body sees the extends of its type arguments in effect where it is first called, so instances of the same type arguments that see different extends are told apart by a number after the name.

## Strings

- String interpolation is expanded at compile time into a call to the runtime variadic function `lerta_string_concat(a, b, ...)` (this expansion is internal to the compiler, so user-facing variadic parameters are not needed). The total length is computed and allocated once.
- stage0 has flat strings only. A `Binary` has the representation of a `String` (`LertaString` in `runtime/lerta.h`) without the UTF-8 guarantee, so `s.binary` and `decode_utf8` pass the object on.
- **Planned:** the set of representations (in priority order):
  1. Small strings as immediate values (String is a 16-byte value with 15 bytes inline)
  2. Flat strings
  3. **Ropes** (concatenation kept as a tree)
  4. Slices (`StringSlice`)
- **Planned:** rope rules:
  - Operations that do not flatten: concatenation, length, iteration, output (`writev`), equality comparison.
  - Operations that flatten: byte indexing (`s.binary[i]`), passing to C, hashing (use as a dictionary key).
    - So the O(1) of `s.binary` holds for flat strings. For a rope, the first access costs an O(n) flatten.
  - Flattening replaces the node in place. Implemented with an explicit stack (no recursion).
  - A concatenation with a short result copies immediately without creating a node (equivalent to V8's 13 characters).
  - There is a depth limit. Beyond it, the rope is flattened.

## Regular expressions (planned)

- For literals, the engine's bytecode is embedded in the binary (no parsing at run time). No machine code generation.

## FFI

- C receives pointers to heap representations such as `LertaString*`. **Planned:** the ABI after small strings become immediate values is undecided.
  - Arguments are borrowed (the C side does not release them). Return values carry ownership (returned with reference count 1).
  - **Planned:** avoid direct access to the representation; use the accessors in the runtime header (`lerta_string_bytes(s, &len)` and so on). This survives changes to the representation. Ropes are flattened here.
- **Planned:** headers are parsed with **libclang** (no custom parser; the same approach as Zig's `@cImport` and Swift's clang importer).
- **Planned:** callbacks, a trampoline from closure to C function pointer. If called from another thread, the call is forwarded to the event loop.

## Platforms (planned)

- Targets are Linux / macOS / **Windows**. Windows support comes in Phase 3.
  - No POSIX-specific assumptions from the start (OS dependencies are confined to the boundary of libuv and the runtime).
- libuv absorbs platform differences.
- **Future target: microcontrollers** (STM32 / Cortex-M, ESP32-C3/C6 / RISC-V; Xtensa-based chips after upstream LLVM support matures).
  - `Int` stays fixed at 64 bits (TinyGo's environment-dependent `int` is not adopted). Hot spots use `Int32` explicitly.
  - The event loop is not tied to libuv; **the backend is replaceable** (libuv on PCs; an interrupt-driven scheduler or FreeRTOS/Zephyr on microcontrollers). The boundary is decided during the Phase 2 design.
  - The runtime C code **does not depend on libc** (only about malloc / memcpy). The allocator is replaceable (TLSF and so on).
  - Beware of code bloat from monomorphization. Remedies when needed: merging instances with identical machine code at link time (LLVM mergefunc, lld ICF), and a build option to switch to dispatch through interfaces.
