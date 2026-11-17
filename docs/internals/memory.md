# Memory management

## Reference counts

- **No threads, so counts are non-atomic.**
- An object whose count reaches zero is dropped and freed at once, unless another one is being dropped: it is then queued, and a loop drops and frees the queued objects after it; dropping one may queue more.
  - Why: this keeps the stack flat when a long chain, such as a linked list, is released.
- Static objects, such as string literals, are immortal: exempt from count operations.

## Object headers

- Every heap object starts with a header: its reference count and its **type** (`LertaType` in `runtime/lerta.h`). Every object of the type shares the type, which identifies it for type tests, and holds:
  - its drop function, which releases what the object owns before it is freed;
  - its visit function, which gives a visitor each reference the object holds;
  - its name.
- The drop function releases the references through the visit function, with `lerta_release` as the visitor, so that what is released and what is visited are one list. The generated visit function is `alwaysinline`, so that the drop function calls `lerta_release` directly.
- A String or Binary, which holds nothing, has no type.

## nil

- nil is a null pointer for an optional reference.
- For an optional `Int`, `Float`, `Byte`, `Bool` or enum value, it is `{ i1, T }` with a false flag. `T` is then unspecified, so it is read only where the flag is set.
- An optional type argument made optional again (see [compiler](compiler.md#generics)) nests these: `{ i1, { i1, T } }` for a value. For a reference, or the data of an interface value, null is the outer nil, and the immortal objects `@lerta.nil.<n>`, which each module defines alike for the linker to keep one of, are the nils inside, the first for that of the type made optional again, and so on (`nil_objects` in `compiler/codegen/optional.lerta`). So it stays one pointer, retained and released as a reference is.

## Weak references

- A weak field or local holds a weak box of its object instead of the object (`lerta_weak_box` in `runtime/memory.c`), or null for nil. The box is a heap object that points at the object; one box serves every weak field and local of the object.
- A class's object keeps a pointer to its box after its fields.
- The two pointers are not counted: the object's drop function first clears the box's pointer, and the box's clears the object's. So the object is freed as soon as nothing else holds it, and the box once nothing holds it.
- A function literal that captures a weak local holds the box, and so does a weak function literal for `@`. At each call it takes the object from the box, or returns at once if it is gone, and holds it in its outermost scope.

## Ownership and borrowing

- For now, every expression of a reference type yields an owned (+1) reference, and its consumer releases it.
  - Arguments are borrowed, and released by the caller after the call, except a constructor's, which it takes over (see [objects](representation.md#objects)).
  - A discarded statement value is released at once.
  - An immortal literal is owned for free.
- The exceptions below are borrowed rather than owned (`generate_borrowed` and `borrowing_all` in `compiler/codegen/borrowing.lerta`), so that a loop over an array, or a walk down a tree that passes its nodes on, retains and releases nothing.

### Where a value is borrowed

A value is borrowed only by these consumers (`generate_borrowed`):

- the array or map of an index, or of an assignment to one;
- the object of an assignment to a field;
- an argument of a call, and the function value that a call calls;
- the object of a method call, or of a field or property read;
- the value of a test against nil;
- the subject of a `case`, but not a `var`'s, which an arm may assign (`is_borrowable_in_scope`).

### What is borrowed

- **A local that is not a `var` (a `const`, a parameter or a loop variable), `@` or a top-level `const`** (`is_borrowable` in `compiler/codegen/borrowing.lerta`). The local keeps the value for the whole use, as a top-level `const` does until the end of the program, where each value is unset before it is released (see [top-level values](compiler.md#top-level-values)).
- **A `var`**, where nothing can reassign it meanwhile and drop what it held: one that no closure captures and that is not top-level, which only its function's own statements assign, unless what its consumer evaluates while it uses it, such as later arguments, holds an assignment to its name, as the block of a `case` may (`names_assigned`).
- **A field read**, from an object that is borrowed:
  - where the field holds the same value as long as its object lives: a field of a struct, or one of a class that is not `var` or that no assignment in the program changes, of any instance of a generic class or through a union (`is_assigned_field`, which the checker records as it checks the assignments, all before codegen);
  - or where its consumer runs no code of the program before it is done with it, so that nothing can replace the field meanwhile (`is_borrowable`): as the object of a field or property read (`a.b` of `a.b.c`), the value of a test against nil, or the array or map of an index whose position is a name or a literal, that puts no default, and of a map whose keys are found without functions (which a key's own `hash` and `==` would be);
  - not a `weak` field, nor one narrowed to a member of a union in a box.
- **An array's item**, from an array that is borrowed, not in place (as its position may run code), where no code of the program takes out an item of an array of its type, by `xs[i] = x` or `pop`, which `truncate` calls (`are_items_taken`, which the checker records as it checks each instance of a generic function, before codegen). The item then stays in its array as long as the array lives: `b := bodies[j]` in a loop retains and releases nothing.
  - So does the variable of a `for` over such an array, which the loop holds, unless the body suspends (`borrows_items` in `compiler/codegen/control_flow.lerta`). This took 7.7% of `bench/nbody`'s instructions off.
- **A `const` initialized by a borrowed value** holds it borrowed for its whole scope (`holds_borrowed` in `compiler/codegen/function.lerta`, through `is_borrowable_in_scope`), where:
  - the value is borrowed from no `var`, which any statement of the scope may assign;
  - and the body does not suspend, as the source may change meanwhile.
  - Reading it, as returning or capturing it, retains it as reading any local does.

Not borrowed:

- a captured or top-level `var`, which a function called meanwhile may assign;
- a weak local's object, which may go meanwhile;
- a value converted to another type, which the conversion makes anew;
- the object of an Iter's methods `has_next` and `next`, which they take over.

## Leak checking

The leak report is described in [the reference](../reference/compiler.md#build).

- **Counting.** A debug runtime counts live objects (allocations minus releases, excluding immortal static objects), the frames of coroutines among them. It keeps the objects in a list, through the prefix before each (`LertaPrefix` in `runtime/internal.h`), in `runtime/leaks.c`, which does the checks below.
- **Trial deletion.** As the program ends, it finds the objects that nothing in use holds, as CPython's cycle collector does:
  - It takes from each object's count the references that the objects hold, which each object's type visits.
  - What is left is held from outside the objects (by a local, a top-level value, a coroutine's frame or the runtime), so those objects, with what they hold in turn, are in use.
  - The rest, held only by objects that nothing in use holds, such as a cycle and what it holds, are reported by their types' names.
  - So no roots are listed, and the check works wherever the program ends, through `exit` too, with whatever is in use, which is not released then.
  - Its counts are spent, so nothing runs after it.
- **What it cannot visit** counts as held from outside: a coroutine's frame, whose layout LLVM makes (see [functions that yield](iteration.md#functions-that-yield)), and so a generator's `Iter`, which holds its coroutine. A cycle through one is not reported as unreachable; at the end of the top-level code it is counted among what is left alive.
- **At the end of the top-level code**, where everything has been released, what is left alive besides is reported by its count.

### Which builds check

- Release builds do not count.
- A build without `-O`, or with `--memory-checks`, uses the debug runtime: the runtime compiled with `LERTA_DEBUG`. With `-O`, it is optimized as the release one is, and its cache is named `release-checked`.
- A leak ends the program with `LERTA_LEAK_EXIT_CODE` (`runtime/internal.h`). So these fail on a leak by the exit status:
  - the run tests, which build so;
  - the compiler's own builds that run with the debug runtime: minilerta, stage1 and the bootstrap's stage2.
- `bin/lerta` is built without the checks, so the compiler's leaks are found by stage2. Since the compiler's source exercises only some of the compiler, the leak checks have stage2 run `dump-llvm` and `fmt` on every source of the tests and examples, for the host, and so on every standard module they import.
  - Not checked: the other commands, such as `build`, `fmt --fix` and `lsp`, and the code only for other systems.

## Allocation

- The runtime's own allocator (`lerta_mem_alloc`, `lerta_mem_realloc` and `lerta_mem_free` in `runtime/allocator.c`) allocates objects, the buffers they own (such as an array's items), and the frames of coroutines.
- The runtime's own buffers, which a program does not make often, stay with `malloc`:
  - its queues, such as of what is to be dropped, which grow seldom;
  - what it hands to libuv, such as the output of a program that it runs;
  - what it holds for a system call, such as a path as a C string; some of these the C library gives, as `realpath` and `strdup` do, and must go back to `free`.
- libuv keeps `malloc` too, since its thread pool may allocate, which the allocator, without locks, does not allow.
- **Reallocation.** `lerta_mem_realloc` keeps the place while it holds the new size and is not more than twice as large, and else moves the contents to a new one. So growing an array copies its items at each step beyond its place, as `realloc` does unless it can grow in place.
- A frame's size is rounded up to a multiple of 16, whose places are aligned to 16 bytes, as malloc aligns.

### Regions

- All the allocator hands out lies in a region from the system, aligned to 64 KiB, so that the region of anything allocated is its address with the low 16 bits cleared, and freeing needs no size.
- Regions come from platform functions (see [platforms](platforms.md#platforms)), which a microcontroller would replace with a static heap:
  - on POSIX, `mmap`, which over-allocates and unmaps what lies outside the alignment;
  - on Windows, `VirtualAlloc`, whose allocations are aligned to 64 KiB.
- A region starts with a header that tells what it holds.

### Size classes

- A region of 64 KiB is a **slab** of places of one size class:
  - from 16 up to 256 bytes, in steps of 8, since an object is a header and fields of 8 bytes on a 64-bit system and needs no more alignment, which no object of the runtime may need either;
  - above, each range between two powers of 2 split in 4, so that rounding up wastes at most about a fifth, up to 16 KiB.
- Anything larger takes a region of its own, whose header gives its size.
- A slab keeps its size class in its header, so that freeing does not compute it. The header takes room from the places, which, at 16 KiB, leaves a quarter of the slab unused.

### Allocating and freeing

- **Allocation** takes a place from the free list of the first slab of the size class with room, or else from the part of it never used yet. Each class keeps a list of its slabs with room; a new slab is taken when there is none.
- **Freeing** puts the place back on its slab's free list, or returns a region of its own to the system.
- **Fast path.** `lerta_mem_alloc` itself takes a small place only from a slab that still has room after it, and leaves every other case to a function of its own. So it is small enough for LLVM to inline into the generated code, where the size is a constant and its size class is computed as it is built.

### Empty slabs

- A slab whose last place is freed, unless it is the last of its class with room, is kept for reuse by any class and never unmapped.
  - So a program that drops a structure and makes another as large, as `json` in `bench/` does with what it parses, maps no slab again for it, and none maps more slabs than it used at once.
- A slab that no allocation takes for a round is discarded, with `madvise` on POSIX and `MEM_RESET` on Windows, which lets the system take its pages back while it stays mapped.
  - A round ends after twice as many events as slabs were ever in use at once. An event is a slab taken or kept, or an allocation that leaves `lerta_mem_alloc`'s own part.
  - As many slabs as are in use, or 4, whichever is more, are not discarded.
  - So a program keeps empty for long no more memory than it uses, while one that makes and drops a structure over and over discards nothing for it.
  - The rounds are counted in slabs, not in time, so that the same program discards the same slabs on every run.
- The empty slabs are listed in a region of their own, so that a discarded slab holds nothing that the allocator needs.

### Use-after-drop checking

- The debug runtime keeps a prefix before each object (`LertaPrefix` in `runtime/internal.h`), and sets the object's count to 0 as it frees it.
- The allocator keeps a free place's first 8 bytes at 0, and its free-list link next, and fills the rest with 0xDB bytes (`FREED_BYTE` in `runtime/allocator.c`). So the object's count, which follows the prefix, stays 0 or reads below 0 while the place is free.
- So a retain or release of a dropped object, or of one queued to be dropped, which one release too many in the generated code leads to, finds the count at 0 or below, and the debug runtime stops the program.
- A read of the place without them, as through a borrowed reference, reads 0xDB bytes: a pointer that faults, as 0xDBDB... is no address that a 64-bit program can map, or a number that a test's expected output tells apart.
- **Reuse order.**
  - A release build reuses the place freed last, which is warm in the cache.
  - A debug build hands out the part of a slab never used before any freed place, then the place freed first; it keeps its last 4 empty slabs without reusing them, and unmaps those before. So a place stays free, and a misuse is caught, as long as possible.
- Not caught: a misuse of an object whose place has been reused. A misuse in a region returned to the system, as that of an object larger than 16 KiB is at once, faults, unless the system has mapped the region again.

## Alias analysis

- The generated code tags some loads and stores with the metadata of clang's type-based alias analysis (`compiler/codegen/alias_tags.lerta`), so that LLVM knows that writing one kind of memory leaves another as it was, and keeps reads of it out of a loop.
- Each kind is a type of its own under clang's `omnipotent char`, in the tree of the runtime's C types, which is compiled with them under link-time optimization:
  - the items of arrays and the values of maps: the runtime's C moves them only by `memcpy`, never as a C type, so writing one leaves an array's length and items pointer, which the C reads as an integer and a pointer, as they were;
  - the `Float` and `Float32` fields of classes and structs;
  - top-level values and the flags that tell that they are set;
  - the read of the pending exception, tagged as the C pointer clang tags it as (`any pointer`).
- Other accesses are untagged, which LLVM takes as touching anything.
- A kind stays sound as long as no access to its memory names another kind's tag: only the generated code reaches fields and top-level values, and only through tagged or untagged accesses of their own kind.
- So writing the `Float` fields of `bodies[j]` in `bench/nbody` lets LLVM read the top-level `bodies`, its flag and the pending exception once before the loop.

