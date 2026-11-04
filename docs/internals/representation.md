# Representation

## Objects

### Classes and structs

- A class or struct object is a heap object: the header, then its fields in declaration order, each in its IR type, and, for a class, the pointer to its [weak box](memory.md#weak-references).
- An anonymous struct is a heap object like a struct, with its fields in name order; so is a tuple, with its items in order. Each structural type has its own LLVM type and type of objects, generated where it is first used.
- Methods are functions that take the object first.

### Construction

- Each type has a generated constructor function, which, unlike any other call, takes its arguments owned. So a new value given to it, as `Node(left: make())`, is stored without a retain and a release; a local's value is retained before the call.
- It stores the arguments given first, so that the fields own them before an initializer or `init` can throw. An initializer, reading only the fields before it, cannot see the difference. Then it computes the initialized fields.
- **A constructor that throws** (see [the reference](../reference/objects.md#a-construction-that-throws)): when its initializers or `init` throw, it releases the fields, which start as nil, and calls the runtime's `lerta_free_unfinished`, which:
  - drops what that queued (as in a constructor that a `deinit` calls, during a drop);
  - stops the program if the count is not 1, since `init` let the object escape;
  - otherwise detaches the weak box and frees the object without running its `deinit`.

### Drop and deinit

- The generated type's drop function releases the references the fields hold.
- For a class with `deinit`, it first runs it through the runtime's `lerta_run_deinit`, which:
  - sets the object's count to 1 while `deinit` runs, so that passing `@` on and releasing it does not drop it again;
  - drops at once what `deinit` released, which is otherwise queued until the drop ends;
  - stops the program if the count is not back to 1, since `deinit` then kept the object.

### Closures

- A function value is a closure: a heap object with the header, the pointer to its code, then its captured values.
- The code takes the closure first, then the arguments, borrowed as in any call.
- A function literal's closure is allocated where the literal is evaluated, with the captured values copied in (references retained), and a generated type whose drop function releases those that are references.
- **Immortal closures.**
  - A closure that captures nothing, such as that of a top-level function, is an immortal constant. Its code is a generated thunk that calls the function without the closure.
  - The closure of a literal declared as a local that is only ever called in its own function (`escaping_locals` in the checker's facts) is on the stack, immortal too, unless it yields or awaits (the call's Iter or Promise would hold it) or captures weakly. It borrows what it captures, which outlives it, and LLVM, which sees its code, calls it directly.
- A method, a C function or a generic function used as a function value (see [function values](../reference/functions.md#function-values)) is checked and generated as the function literal that calls it, with parameters of names that the source cannot write, which the checker puts in its place (`compiler/checker/function_references.lerta`, `NodeFacts.replacements`).
- The heap cell of a captured `var` (see [execution model](execution.md)) is a heap object with the header and the value. Cells of types of the same representation share one layout and type.

### Unions

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
- A `T?`, of one member and nil, stays the pair of a flag and the value (see [nil](memory.md#nil)).

## Interfaces

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

## Builtins

What `std:builtins`, in the files of `std/builtins/`, cannot write in Lerta (see [the reference](../reference/builtins.md#methods-of-the-builtin-types)).

### Built into the compiler

- **Items in place.** The generated code reads and writes the items of arrays, maps and Iters in place, as their types, at the place that the runtime gives once it has checked the index (`lerta_array_checked_items`) or found or placed the key (`lerta_map_find` and `lerta_map_place`), so that no copy of a size known only at run time is made.
  - An item is an integer of fewer than 64 bits, or a `Bool` as a byte, at its own size; two pointers for an interface value; and 8 bytes otherwise. Items are retained by kind (see [memory management](memory.md)).
  - The operations: `length`, indexing, `push`, `pop`, `remove`, `keys`, `entries`, and the Iter protocol, `has_next` and `next`.
  - Their loads and stores have a type-based alias tag of their own (see [alias analysis](memory.md#alias-analysis)).
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

### C functions that extends call

- `lerta_binary_text` gives `text` the bytes as the same object if they are valid UTF-8, checking 8 bytes at a time while they are ASCII.
- `lerta_string_slice` gives `split`, `split_once`, the `trim`s and std:scanner the bytes of a String between two characters, as a String too, as it checks that both ends are at a character.
- std:math's `pow`, whose result C checks, as i686 holds what libm returns in an x87 register, wider than a `Float`, until it is stored.
- `print` and `print_error` write with `lerta_print_stdout` and `lerta_print_stderr`, which write at once rather than through the buffer of `stdout` (see [output](platforms.md#output)).

### std:json

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

### Written in Lerta

- `join`, `to_binary`, `repeat` and the integer types' `to_string`, from the first digit, append with `+=`.
- `split` finds its separator with `index_of`, which compares one byte at each place for a separator of one byte, and `occurs_at` at each byte for a longer one.
- A String's `compare` compares bytes. `<` and the like of Strings test its Ordering, through a call of it that the checker makes (`order_calls` in `compiler/checker/shared.lerta`).
- `sqrt` and `remainder` check their arguments before calling libm.
- An array's `to_string` writes the `to_literal` of its items.
- `parse_int` reads bytes with `b[i]`; `contains` reads the map; `values` is a comprehension over `entries`; `iter` of an array or a `Binary` is a comprehension.
- The methods of an extend of `Iterable<T>`, which `Stringable` and `Iterable` are declared beside, are written once for all: `map`, `filter` and `to_array` are comprehensions; `any`, `all` and `find` are `for` loops; `take` and `zip` are Iters written in Lerta.

## Floats

### Representation

- A `Float` is a `double` and a `Float32` a `float` (`compiler/codegen/float.lerta`). They share their code but for the IR type.
- **Literals.** A literal's text is converted by the runtime's `strtod`, or `strtof` for a `Float32`, which the compiler calls (`lerta_float_literal_bits`, `lerta_float32_literal_bits`). It is written into the IR by its bits in hexadecimal, as LLVM takes a decimal constant only if the double holds it exactly. A `float` constant is written as the `double` of the same value.
  - `strtof` rounds a `Float32`'s text to a `float` at once, as rounding it to a `double` first could round it twice.
- The infinity that std:math names `INFINITY` is made of its bits (`lerta_float_from_bits`), rather than from `1.0 / 0.0`, as std is built by the seed too, whose code throws for that division.
- The comparisons are the ordered ones of `fcmp`.
- A 32-bit x86 target computes with SSE2 (`-msse2 -mfpmath=sse`). The x87, which it uses otherwise, keeps more precision and range than a double, so that a result too large for one would be finite rather than an infinity.
- **In arrays and maps.**
  - Arrays hold a `Float` as an 8-byte item, its bits, and a `Float32` as a 4-byte integer item, its bits.
  - A map holds a `Float` key as the word of an `Int`: the bits of the value, with `-0.0` made `0.0`, so that equal `Float`s are the same key. A `Float` inside a key hashes likewise. A `Float32` key likewise, its bits zero-extended.

### NaN checks

No `Float` or `Float32` is NaN (see [the reference](../reference/types.md)), so arithmetic checks its result for NaN (`fcmp uno`), which needs no magnitude, as a check for an infinity would. Several strategies check fewer results; `--eager-nan-checks` (`ModuleCode.eager_nan_checks`) turns off all of them, so that each operation checks its result where it is.

- **Trees.** A tree of `+ - * /` and negations, of locals, the fields of classes and structs read through them or `@`, literals, and calls that give a float, checks only its root (`float_tree` in `compiler/codegen/operator.lerta`).
  - A NaN in it, which each operation gives for a NaN operand, is a NaN at the root. The error is the same, reported where the tree is rather than where its operation is, after the calls in it, which check their arguments as they are called (`generate_call_in_tree`).
- **Deferred `const`s.** A `const` local whose value is such a tree, unless its ranges (below) show that it gives no NaN, holds it unchecked (`defers_declaration` in `compiler/codegen/function.lerta`), so that a tree that it goes on into checks it once, at its root. This does not apply to a `const` that a function literal captures as a var.
  - It is checked where it is read (`check_where_read`), but as a leaf of a tree whose root checks it; so where its value leaves the arithmetic. A NaN that is never read throws nowhere.
  - A tree whose root its ranges show to give no NaN, which checks nothing, still checks its result where it reads such a local, as the ranges take no local for NaN: once, after the calls in it, as a NaN of any of the locals reaches the root (`reads_unchecked_floats`).
- **Compound assignments.** `x += e`, `-=`, `*=` and `/=` of a `Float` or `Float32` local or field, where `e` is such a tree or a leaf, are a tree too. Its root is the combining operation, whose other operand, the old value read after `e`, is a leaf too. The target keeps its value when it throws.
- **Batches of field writes** (`batched_field_writes`). Such assignments of `Float` or `Float32` fields of a local or `@` that follow one another, with no call in their trees, are a batch, up to one that reads a field of a name that one before it writes (its target's old value too), but not including the last statement of a body.
  - Their values are all computed first, one branch checks them all for NaN, and the stores follow, so that LLVM keeps the writes together, as no check stands between them.
  - Where one is NaN, the branch takes them one by one, each checked and then stored, so that the first that is NaN throws where it is, after the writes before it.

### Ranges

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

## Maps

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
- **Removal** marks the entry not live, in place. When the entries are full, they are compacted, unless a cursor of the map is alive (see [Iter](iteration.md#iter)), and the index is rebuilt with room for twice the entries kept.
- **Defaults.**
  - `m[k, default: d]` finds the key once where it is there (`generate_put_default` in `compiler/codegen/collection.lerta`). Where it is not, it evaluates `d` and places the key, which looks again, as `d` may have changed the map.
  - `+=` and the like on it (`update_with_default` in `compiler/codegen/assignment.lerta`) read the value, or the default, and write the result at the place found, where the key was there, as nothing but the operator runs between the find and the write.
  - A missing key, for which the default ran, is placed anew, and so is any key where `+=` goes through a method of the value's type, which may change the map.

## Strings

- Strings are flat only, for now.
- A `Binary` has the representation of a `String` (`LertaString` in `runtime/lerta.h`) without the UTF-8 guarantee, so `s.binary` and `b.text()` pass the object on.

### Interpolation

- String interpolation is expanded at compile time into a call of the runtime's variadic function `lerta_string_concat_taken(a, b, ...)`, which takes the parts. (The expansion is internal to the compiler, so programs need no variadic parameters for it.)
- The total length is computed and allocated once.
- The longest part that nothing else holds, and whose place has room for the result, is extended there and its bytes moved to their place, so that it is not copied into a new one. The `to_string` of `"w#{n}"` often has that room in its size class.
- A part without the room is not grown, which would leave the result in a place of twice its size, as `+=` grows a String.
- `lerta_string_concat`, which borrows the parts, copies them all. The runtime's own C calls it, and so does the code that the seed generates.

### Appending

- `a + b` of a String or a Binary calls `lerta_string_extend`; of a Byte, `lerta_binary_push`; of a Char, `lerta_string_push`, which writes its UTF-8.
- They take `a`: when nothing else holds it, its count being 1, the bytes are appended in place.
- `lerta_grow` keeps the object's place while the allocator's place has room (`lerta_mem_capacity`), and else moves it to one of twice the size, so that a loop of `+=` copies O(n) bytes in all.
  - The move (`move_to_room`) and the copy of a String held elsewhere (`copied`) are functions of their own, so that an append that fits is short enough for LLVM to inline into the generated code.
  - Moving is safe, since a String or a Binary is never held weakly nor thrown, which are what know an object by its place.
- `+=` on a variable or a field evaluates the right side first, then reads the target and passes its reference on, so that the count is 1 if nothing else holds the value, with no retain and release around the right side. On an array item, the array still holds it, so a new one is made.

## FFI

The C types of an extern, and the ownership of its arguments and result, are in [the reference](../reference/functions.md#c-functions).

