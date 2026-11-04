# Execution model

- A function's locals are on the machine stack, in slots that LLVM makes registers.
- A `var` that a closure captures lives in a heap cell of its own.
- A closure holds the values that cannot change (`const`s, parameters, loop variables), copied in, or borrowed for one on the stack (see [objects](representation.md#objects)), and the cells of the `var`s it captures.
- What a function that yields or awaits keeps across a `yield` or an `await` is in its coroutine frame, on the heap, which outlives the call that made it (see [functions that yield](iteration.md#functions-that-yield) and [functions that await](iteration.md#functions-that-await)). Suspended functions are linked by which one awaits which: a spaghetti stack on the heap.
- Why cells, as Swift boxes each captured `var`, rather than a context of all the captures of a scope (the V8 approach): a context would keep each capture alive as long as any closure of the scope, and would not hold what lives across an `await`, which is in the coroutine frame anyway.

## Exceptions

- **Error return values (the Swift approach).** A throw sets the global pending exception, an interface value of `Error` (there are no threads, so a global is fine), and leaves the function as a `return` does, releasing what its scopes hold.
- **Checks.** Each call that may throw is followed by a check of the pending exception, which leaves the caller in turn, up to a `try` whose `catch` takes the exception, or to the program's end, which reports it as uncaught.
  - Calls that may throw: of a Lerta function, a closure, an itab's entry or a C function of the runtime.
  - Not checked (`may_leave_exception` in `compiler/codegen/builtins.lerta`): a builtin method that calls nothing that may throw, such as a number's conversion or `compare` or an enum's `to_string`; a number's operator called as a method, whose overflow throws as the generated code's own checks do.
- **Branch weights.** The branch of each check to the unwinding, and that of the generated code's own checks to their throw, carries the weights that clang gives `__builtin_expect` (`emit_seldom_branch` in `compiler/codegen/ir_builder.lerta`). LLVM then lays out the code, and assigns registers, for the other way first.
  - Without the weights, ThinLTO saved the registers that a recursion needs before its base case on the Mac, which made `fib` half as slow again.
  - A recursion's base case still saves and restores the registers that the recursion needs, as LLVM saves them on entry. It saves them only on the paths that need them (shrink-wrapping) for a function marked `nounwind`, but only in clang 21 without ThinLTO, and not in clang 15 even then: marking every function so changed no benchmark's instructions.
- **Hidden.** The pending exception is hidden, in `runtime/lerta.h` and in the generated code's declaration (`exception_global` in `compiler/codegen/exceptions.lerta`), so that a check reads it directly. A symbol that another library might define is reached through the table of addresses, whose entry ThinLTO kept in a register across calls, which a function then saved and restored; hiding it took 11% of `bench/expr`'s instructions off, and 1 to 3% of most others'.
- **Temporaries.** An expression that holds an owned value while it evaluates others, as a call holds its arguments, registers it as a temporary, which an exception releases on its way, as it does the scopes it leaves.
- **Set aside.** A `finally` block, whose calls are checked, runs with the exception set aside; so does a `deinit` that a release runs (`lerta_run_deinit`), which may not throw one of its own.
- **Jumps out of a `try`.** A `return`, `break` or `continue` that leaves a `try` generates a copy of its `finally` block where it jumps, run as the code after the `try` would run it: with the scopes inside the `try` released, and an exception it throws going to the `try`s outside.
  - So a `finally` block is generated once for each jump out of its `try`, besides its ends. A jump through a shared copy would need to tell where to go on after it, which the copies need not.
- Why: unwinding reuses the release on `return` and `break`, needs no tables or `longjmp`, and works alike on every platform. A throw across an `await` cannot unwind the machine stack anyway, since the awaiting function's frame is no longer on it: it is carried as the failure of the asynchronous result, which this approach does within synchronous code too. The cost is a load and a branch after each call.
- Considered: a frame chain with `longjmp` (needs a frame record listing the references in every function) and LLVM's zero-cost unwinding (needs landing pads, unwind tables for the runtime's C code, and Windows' SEH apart).

### The runtime's errors

- A C function of the runtime that throws calls `lerta_raise` with the error's kind and message, and returns.
- The generated code checks the pending exception after each call of such a function, except where the result alone tells that it threw (`emit_exception_check_if` in `compiler/codegen/exceptions.lerta`): the null items that `lerta_array_checked_items` gives for an index out of range, so that reading or writing an item loads no global.
  - That function tells LLVM that the items of an index in range are not null, so that a loop it is inlined into checks none.
- An array's index is checked as unsigned, which does better where a loop runs to a bound other than the array's length, as in `bench/sieve`.
- After `Array(n, v)`, once it has not thrown, LLVM is told that the array's length is `n` (`emit_assume_length` in `compiler/codegen/array.lerta`), so that a loop that runs to `n` checks an index by the comparison of its condition: that took 9% of `bench/sieve`'s instructions off.
- A Binary's length and bytes are read in place. Its index, negative or at or beyond its length, throws by the generated code's own check: two signed comparisons, so that LLVM drops the second where a loop's condition has made it, as `i < bytes.length` does. One unsigned comparison could not be dropped without knowing that the index is not negative.
- `lerta_raise` calls a function that the compiler generates in `std:builtins`, which constructs the error of the kind's type and sets it as the pending exception. The error types are structs of the module that declares the `Error` of `std:builtins`. The program registers that function first thing.
  - A program that is `std:builtins` or a module it imports, without those types, registers none; the runtime then stops the program at once.
- The generated code's own checks, such as for overflow, throw the same way where they fail.

## Exception traces

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

### Source lines

With `--source-lines`, each module's IR carries LLVM's debug information of the line tables (`compiler/codegen/source_lines.lerta`):

- a compile unit;
- a subprogram for each function of the program, by the name that traces give it, starting at the line it is declared at;
- a location on each instruction, of the statement or expression that the generator is at, as the sites are.
  - An instruction before the first, as of the code that a function runs before its body, takes the function's own line, since LLVM requires a location on every call in a function that has a subprogram.
  - Code that is no function of the program has none.
- A function that has a subprogram is `internal` rather than `private`, so that it has a symbol, by which `dsymutil` finds its information on macOS.

## Stack overflow

- **POSIX.** The runtime relies on the guard page below the stack: touching it raises SIGSEGV (or SIGBUS). The handler, on a stack of its own (`sigaltstack`), panics if the faulting address is in the stack's range. A stack without a limit, or with one beyond the address space, has no such range. Other faults keep their default action.
  - It costs nothing per call.
- **Windows** raises `EXCEPTION_STACK_OVERFLOW` in the overflowing thread, on what is left of its stack. A vectored exception handler panics on it; other exceptions go on to the handlers after it.
  - `SetThreadStackGuarantee` keeps 64 KiB of the stack for the handler.
  - The handler writes the message and ends the process with `TerminateProcess` (exit code 3, as C's `abort` gives there), since the code that `ExitProcess` runs may need more stack.

