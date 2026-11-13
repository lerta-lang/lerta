# Iteration and awaiting

## Iter

- A `for` is desugared into the source iterator and a closure for the body. No coroutines are needed.
- **Layout.** An `Iter` is a heap object (`LertaIter` in `runtime/lerta.h`): the header, the pointers to its `has_next` and `next` code, which take the `Iter` itself, a started flag, then the state of its kind.
- **Kinds.** Each is generated once per type it depends on:
  - the items of an array or a `Binary`;
  - the integers of a range;
  - the entries of a map, which a cursor of the runtime (`LertaMapCursor`) reads by their positions, so that the map does not compact them while it is alive;
  - `map` and `filter`, which own their source `Iter` and closure;
  - an Iter written in Lerta, which holds its value as an interface value (see [Iters written in Lerta](../reference/types.md#iter));
  - the generator kind: see [functions that yield](#functions-that-yield).
- A lazy comprehension is a `map` of its element's closure over its source, through a `filter` of its guard's closure if it has one. The methods `map` and `filter` are such comprehensions (see [builtins](representation.md#builtins)).
- The started flag makes a second traversal throw (see [the reference](../reference/types.md#iter)).
- **Over a `String`.** A `for` or a comprehension over a `String`, or over its `iter()`, makes no `Iter`: it reads the UTF-8 in the loop, as one over a `Binary` reads its bytes (`compiler/codegen/string_loop.lerta`). An ASCII byte is its `Char`; another lead byte is decoded by std's `char_at`, and the length of its sequence is told from the byte in the loop. The place of the next `Char` is stored before the body runs, so that a `continue` goes on from it. A `for c in s` then takes about 11 instructions for each ASCII character, against 10 for `for b in s.binary`.

### Devirtualizing the chain

No intermediate data structures are made, but each item goes through calls of code pointers. LLVM turns them into direct calls and inlines them, once the chain is made and consumed in one function:

- **Invariant fields.** What an `Iter` or a closure keeps as it is made is accessed with `!invariant.group` (`fixed` in `HeapField`, which `store_state` refuses to write): its code, the state that its kind never writes again (such as the source and the closure of `map` and `filter`), and a closure's captures (a value or the cell of a var).
- The new object's pointer is laundered (`llvm.launder.invariant.group`), so that LLVM, which cannot otherwise see that the calls in between leave the fields, takes what was written for what is read.
- **Devirtualization rounds.** As each call LLVM inlines makes one more direct, the link of an optimized build lets LLVM optimize a function again up to 8 times where a call becomes direct, rather than 4 (`DEVIRT_ITERATIONS` in `compiler/clang.lerta`), so that a chain of `map` and `filter` over a generator inlines its closures too.
- **One way out.** A comprehension's `Iter` is made before the traversal of its source `Iter` starts, which throws if one has, releasing it then. So a function that gives it, as an Iterable's `map` does, gives what it made on its only way out, which LLVM, once it inlines the function, takes for that very `Iter`.
- A `for` over a call of a function that yields, over a lazy comprehension, or over `map` and `filter` given a function literal, is [fused](#fused-loops) instead; so is a chain of them that a method of an Iterable such as `sum` consumes (see [inlined methods](#inlined-methods)).

## Functions that yield

- A function that yields is generated as two functions (`compiler/codegen/yielding.lerta`, with the coroutine's own parts in `compiler/codegen/coroutine.lerta`):
  - the one that calls reach, which makes an `Iter` of the generator kind and calls the other;
  - its body, as an LLVM coroutine (`presplitcoroutine`, switched-resume lowering), which takes the `Iter` before its arguments.
- LLVM's CoroSplit pass, which clang runs at every optimization level, splits the body into the functions that start, resume and destroy it, and moves the values that live across a suspension into its frame.
- The frame is allocated by `lerta_frame_alloc`, which counts it as a live object for the debug runtime's [leak check](memory.md#leak-checking).
- **Arguments** are borrowed for the call only, so the body retains its parameters, `@` and its closure, and holds them in its outermost scope. It then suspends once before its statements, so that the call runs none of them.
- **State.** The `Iter`'s state is the coroutine's handle, a running flag, and a held flag with the item.
  - `yield` stores its value, owned, as the held item and suspends.
  - `has_next` resumes the body unless an item is held or the body is at its final suspension (`llvm.coro.done`); `next` takes the held item.
  - Resuming a running coroutine is undefined in LLVM, so `has_next` throws instead when the running flag is set.
- **Ending.** The end of the body, `return`, and an exception that no `try` in the body takes release its scopes and go to its final suspension.
- **Destroying.** The `Iter`'s drop destroys the coroutine (its handle field is held as `Ownership.COROUTINE`), which takes the destroy branch of the suspension it is at:
  - at a `yield`, it releases the temporaries and scopes held there, as an uncaught exception does, then frees the frame;
  - at the final suspension, it only frees the frame.
  - A `finally` would not run on that way out, which is why `yield` cannot be in a `try` that has one (see [the reference](../reference/functions.md)).
- Why LLVM's coroutines rather than a state machine of the compiler's own: the frame, which values live across a suspension (phis and temporaries included), and the splitting are what CoroSplit does. The compiler says only where the body suspends and what it releases when destroyed, which the code for `return` and for exceptions already generates.

## Fused loops

Fusion generates the loop's source in place (`compiler/codegen/fusion.lerta`), so that no `Iter`, closure or coroutine is made and LLVM sees one loop.

### Over a function that yields

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
- **Release order** is innermost first: the loop's locals, then the function's, then the arguments. Where that happens while an object is dropped, as when a function that yields is dropped while it waits in such a loop, the runtime queues what is released and drops it after (see [reference counts](memory.md#reference-counts)).

### Over a lazy comprehension

- **When.** A `for` without an index over a lazy comprehension of no index and no bindings.
- It goes through the comprehension's source itself, its item held under a name that the source cannot write, and for each item generates the guard's function, then the element's, in place, then the loop's body with the element.
- A source that is itself such a comprehension, or a call of a function that yields, is fused in turn.
- Each function is generated with the item as its parameter, by a generator of its own, named as the closure would be in traces.
  - Its scope holds what it captures as the loop's locals, borrowed, so that it reads a var as it changes, as the closure does through its cell.
  - Its `return`, which ends it, and its exception, which goes on from the loop as from the closure's call there, release none of them.
- **Not fused:** a function that is weak, captures weakly, yields or awaits keeps the comprehension's `Iter`, as a coroutine of its own cannot run inside the loop.

### Over map and filter

- A call of `map` or `filter` of std:builtins over an array or an `Iter`, given a function literal, is gone through as the lazy comprehension that the method is written as:
  - `xs.map(f)` as one whose element is `f`;
  - `xs.filter(keep)` as one whose guard is `keep` and whose element is the item itself.
- Its trace has no site of the method's own closure, which only calls the literal: an exception out of the literal goes on from the loop as from that closure's call there.

### Deferred locals

- A `:=` local is not declared, and its value is generated at the read instead, as if written there (`defers_to_read`), so that the loop or the method there fuses it in turn, where:
  - its value is one that a loop fuses: a call of a function that yields, a lazy comprehension, or `map` and `filter` given a function literal;
  - the parts of it that are evaluated before its loop could not change in between (see [inlined methods](#inlined-methods));
  - it is read once, in its own scope, as what a loop or a comprehension goes through, or as the object of a method;
  - no function literal captures it;
  - it is not a top-level value, which functions read too.
- The checker finds such reads (`lazy_reads` in its facts). The local's own scope makes what the value reads by name the same at the read.

## Inlined methods

`compiler/codegen/inlined_methods.lerta` generates a method's instance body in place, so that the method's loop goes through the receiver in place and no `Iter` is made.

### When

- **The method**: one of std:builtins whose body goes through `@` in one `for` without an index, and reads `@` nowhere else, such as `sum`, `fold`, `count`, `any`, `all` and `find` of an Iterable.
- **The receiver**:
  - one that a loop fuses: a call of a function that yields, a lazy comprehension, or `map` and `filter` given a function literal, over such a receiver, a local or a field, or a comprehension over a range;
  - or an array or a `Binary`: a local, a field, or the `Binary` of a `String`.
- **Stable parts.** The receiver is evaluated where the method's loop starts, after the method's arguments, rather than before the call. So the parts of it that are evaluated before its loop, the arguments of a function that yields and a range's bounds, must be values that can neither throw nor change:
  - literals;
  - locals and top-level values whose reads check neither for NaN nor that they are initialized, and that are not vars, which the arguments could assign, nor `Iter`s, which they could traverse;
  - fields of fields, and so on, of such values, which are not `Iter`s or floats either, and the `Binary` of one that is a `String`, where the method is given only such values and function literals, which assign none.

### Generation

- The method's body is generated by a generator of its own, with the instance's facts and the code of its module, which shares the IR, as a function taken in place is (see [fused loops](#fused-loops)).
- **Arguments** are evaluated first, owned, and held until the body ends. The defaults of those left out are computed by the body's generator.
- **Function literal arguments.** For a parameter that the body only calls (`escaping_locals` in the instance's facts):
  - the literal's closure is on the stack, as that of a local is (see [closures](representation.md#closures));
  - each call of the parameter generates the literal in place with its arguments, as a loop takes a lazy comprehension's functions, unless the literal is weak, captures weakly, yields or awaits;
  - the closure is still made, unused, so that what it captures is checked where the literal is.
- A `return` stores the value in a slot and goes to the call's end. An exception that leaves the body goes on from the call, as from a call there.
- **The loop.** The call's generator goes through the method's loop, and the method's generator generates each item's body.
  - Each holds the other's scopes under names that the source cannot write, so that what jumps out of either releases them: the method's scopes while the receiver's code is generated, and those of the receiver's loop while the body is.
  - The body's `break`, `continue` and `return` reach the receiver's labels through a loop that the method's generator gets with their depths.
  - An exception out of the receiver's code goes to a handler of the call's generator, which goes on from the method's loop, as from the calls of the receiver's `Iter` there.
  - The receiver's code adds no site of the call's own (`traceless`), which a call of the method would not add either.

## Functions that await

### Generation

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
- **An unhandled rejection.** A `Promise` released while still rejected, its exception never taken, ends the program with that exception's message (see [functions that await](../reference/functions.md#functions-that-await)), unless a cancel has gone through it (`cancelled`, below) and the exception is a `CancelledError`, which the type in its header tells, as a type test does.

### Top-level code

- A module's top-level code that awaits is generated as a function that awaits, without parameters.
- The program's top-level code, the entry module's after that of the modules it imports, is then one too, which awaits each of theirs that awaits.
- `lerta_main` starts it and:
  1. has the runtime watch it (`lerta_watch_top_level`), which ends the program as soon as it is rejected, as the loop may still wait for work that never ends, such as an accept, and has the signals that ask the program to end cancel it (runtime/signal.c, see [signals](../reference/functions.md#signals)), after which it ends the program by the signal as soon as it is settled, and which, once it is settled otherwise, stop being watched;
  2. runs the loop;
  3. has the runtime check that it is settled (`lerta_finish_top_level`).
- A program whose top-level code awaits nowhere keeps plain functions.

### The event loop

- `lerta_loop_run` runs at the end of the program's top-level code, before the top-level values are released.
  - It resumes the ready coroutines in the order they became ready, then waits once, on libuv, for what settles promises, such as a sleep's timer or a program's end.
  - It stops when no coroutine is ready and libuv has nothing left to wait for.
- The runtime cannot resume a coroutine itself, as C has no way to call `llvm.coro.resume`, so the generated code passes the loop a function that does.
- **Files.** `runtime/loop.c` holds the loop itself and the thread pool. Each feature that waits uses libuv in its own file, such as `runtime/handle.c` for the network.
  - Why: a backend without libuv replaces the files of the features it has, rather than functions behind a layer of their own that would fit none of them, as on a system without processes or with a network stack of its own.
  - `runtime/output.c` uses libuv's mutex and condition variable too.
- **What waits on the loop:**
  - the sockets of `std:net` (see [network](platforms.md#network));
  - programs that `run` starts (see [processes](platforms.md#processes));
  - work on libuv's thread pool (`lerta_loop_work`): the writes out of stdout and stderr (see [output](platforms.md#output)) and the files (see [files](platforms.md#files)).
  - stdin is read on a thread of its own (see [stdin](platforms.md#stdin)).

### The main run loop

- On macOS, a program that has CoreFoundation loaded, as the frameworks that a linked `.m` file uses load it, waits in the main thread's run loop instead of in libuv, so that what Apple's APIs leave to that run loop runs on the main thread while the program waits: blocks on the main dispatch queue, timers, delegates and notifications.
  - libuv's descriptor, its kqueue, is a source of the run loop, which waits until it is ready or libuv's next timer is due; libuv then runs once without waiting.
  - Why not always: linking CoreFoundation costs each program about as much at its start as the rest of it, so the runtime calls it through `dlsym`, once it finds it loaded.
  - It looks at the first wait, and again at a later one where more libraries are loaded than at the last look, as by `dlopen`, until it finds it: counting them takes a nanosecond, while looking takes tens of microseconds.
- The program still ends when libuv has nothing left to wait for, whatever the run loop has left.

### Cancel

- **Links.** `await` gives the runtime the body's own `Promise` too (`lerta_promise_wait_in`), which records the promise it awaits (`awaiting`).
- `lerta_promise_cancel` goes down those links, marking each promise (`cancelled`), to the deepest body, which it marks to throw (`cancel_requested`), then calls the cancel hook of the promise that body awaits, if there is one.
- **Hooks.** What makes a promise of the loop's work registers the hook (`lerta_promise_on_cancel`). The hook:
  - stops the work, such as a sleep's timer, or leaves it to end with no one to settle, such as a read of a file, a write, which libuv cannot stop once started, or a program that `run` started;
  - then rejects the promise with a `CancelledError` (`lerta_promise_reject_cancelled`).
- A pending promise of `std:async`'s `Deferred` is rejected so.
- **Resuming.** The body, resumed, reads its mark on reading the promise (`lerta_promise_result_in`), so one whose promise was settled before its resume throws too.
  - The cancel discards what it overtakes, the value or the exception, and marks the promise as taken, so that a rejection it overtook does not end the program as an unhandled one does; another await of the promise still takes it.
- A cancelled read of stdin cannot stop the thread that reads it: its chunk is kept for the next read, and the async handle is unreferenced meanwhile, so that it does not keep the program running.

