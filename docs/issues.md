# Issues

Known defects, most severe first.

| # | Title | Severity |
|---|---|---|
| 1 | Narrowing in a function literal outlasts an assignment by a later literal | High |
| 2 | A second type test of an optional union in `else if` is always false | High |
| 3 | `decode_json` crashes on deeply nested input | Medium |
| 4 | A `var` narrowed and then captured makes invalid LLVM IR | Medium |
| 5 | std:http ends the program when a handler responds while it reads the body | Medium |
| 6 | A local that takes the name of a renamed parameter breaks the compiler's build | Medium |
| 7 | std:http accepts control characters in a field value | Low |
| 8 | The compiler crashes on deeply nested source | Low |
| 9 | std:http repeats Content-Length and Connection that a handler puts in `fields` | Low |
| 10 | A Reader refuses a read right after `timeout` ends the last one | Low |
| 11 | `Reader.read` returns an empty Binary at the end after an empty chunk | Low |
| 12 | `while` does not narrow in its body | Info |
| 13 | Testing a weak local for nil does not say why it is not narrowed | Info |
| 14 | The reference says an enum cannot be a member of a union | Info |
| 15 | `LertaPrefix` is aligned to 16 but placed at 8 | Info |
| 16 | `read_console` underflows when given fewer than 3 bytes | Info |
| 17 | `read_console` loops when the input ends after a held high surrogate | Info |

## 1. Narrowing in a function literal outlasts an assignment by a later literal

`forget_narrowing` in `compiler/checker/assignment.lerta` forgets the narrowing of a captured `var` only in the code checked after the literal that assigns it. A literal checked earlier keeps its narrowing, though it may run after that assignment:

```
main := ->
  var callback: () -> void = -> return
  var x: Int? = 1
  g := ->
    if x != nil
      callback()
      print x + 1
  callback = -> x = nil
  g()
main()
```

This compiles and prints `1`, reading nil as an `Int`. A `var` holding a literal that calls itself, and a literal inside a loop that narrows a `var` of the enclosing function, do the same. The checker already rejects the case of a loop without a literal.

The fix is to record the literal bodies that narrow a `var`, and to reject an assignment by another literal to a `var` that one of them narrows, as for loops.

## 2. A second type test of an optional union in `else if` is always false

After `if x is A`, an `else if x is B` on an optional union is false even when `x` holds a `B`:

```
show := (to: Int | String?) ->
  if to is Int
    print to
  else if to is String
    print to
  else
    print 'nil'
show 'text'
```

prints `nil`, where it should print `text`. A union that is not optional, as `Int | String`, tests right.

The cause is not found yet.

## 3. `decode_json` crashes on deeply nested input

`skip_value` in `std/internal/json_reader.lerta` and the read functions that `compiler/codegen/json_read.lerta` generates recurse for each nested array or object, with no limit on the depth. Nesting 100,000 deep, such as `[[[…]]]` as the value of a key the target struct does not have, overflows the stack and aborts the program with exit status 134. A server that decodes JSON from a client can be stopped by one request.

The fix is a limit on the depth, beyond which the reader throws a `JsonError`.

## 4. A `var` narrowed and then captured makes invalid LLVM IR

`captured` in `compiler/checker/closure.lerta` gives the `Capture` of a `var` its narrowed type, while the literal's body sees its declared type. Codegen reads the cell with the type of the `Capture`, so for a value type such as `Int?` or a boxed union such as `Int | String`, clang rejects the IR:

```
var x: Int? = 5
if x != nil
  f := -> print(x ? 0)
  f()
```

A lazy comprehension that captures the `var` does the same.

The fix is to give the `Capture` of a `var` its declared type, as its body sees it.

## 5. std:http ends the program when a handler responds while it reads the body

A handler that starts reading the body without awaiting it, and returns a `Response`, leaves a read in progress on the connection's `Reader`. On a kept-alive connection, `serve_connection` in `std/http.lerta` skips the rest of the body, and the `Reader` throws a `ValueError` for the second read. `serve_connection` catches only `IOError`, so the program ends, though [the reference](reference/modules.md) says each connection catches what it throws.

The fix is for `serve_connection` to catch what the connection throws.

## 6. A local that takes the name of a renamed parameter breaks the compiler's build

Renaming the parameter `base` of `digits_text` in `std/builtins/numbers.lerta` to `unused`, and declaring a local of its old name as the body's first line, makes `make bin/lerta` fail when stage1 builds the compiler, with clang rejecting the IR of a module:

```
digits_text := (n: UInt64, unused: UInt64, negative = false) ->
  base: UInt64 = 10
```

```
module28.ll:213:145: error: constant expression type mismatch: got type '[11271 x i8]' but expected '[11266 x i8]'
```

11266 bytes is the length of `std/builtins/text.lerta`, which the compiler embeds as a string and which the change does not touch, so the embedded string is 5 bytes longer than the type given to it. Either line alone builds, as does a comment that makes the file as long. The cause is not known yet.

## 7. std:http accepts control characters in a field value

`check_field` in `std/http.lerta` rejects only CR, LF and NUL in a field value. A request's `X-Echo: v\x0bx` reaches the handler, and a handler that copies it into a response sends it on. Without CR or LF it cannot split the response, but RFC 9110 does not allow it, and an intermediary may read it differently.

The fix is to allow only visible ASCII, horizontal tab and bytes from 0x80 to 0xFF.

## 8. The compiler crashes on deeply nested source

The recursive descent parser has no limit on nesting. Source with 200,000 nested parentheses or array literals makes `lerta dump-ast` abort with exit status 134 on a stack overflow. `lerta lsp` parses what an editor opens, so a file can stop the language server.

The fix is a limit on the depth, beyond which the parser reports a compile error.

## 9. std:http repeats Content-Length and Connection that a handler puts in `fields`

`response_bytes` in `std/http.lerta` drops the framing fields a handler gives by comparing their names with lowercase ones. A handler that pushes `('Content-Length', '99')` to `fields` directly gets it sent beside the server's `content-length: 3`, and the response's framing breaks.

The fix is to compare the names in lowercase.

## 10. A Reader refuses a read right after `timeout` ends the last one

`first_settled` in `std/async.lerta` cancels the losing Promises and returns without waiting for them to unwind. A read that `timeout` ends has not yet left `Reader.exclusive` in `std/io.lerta`, so a read started right after the `TimeoutError` throws `a Reader is read by another read that has not ended`. After one `await`, it succeeds. std:http awaits a write in between, so it is not affected.

The fix is for `first_settled` to await the cancelled Promises before it returns, though a step that a cancel does not stop, such as a write in progress, then delays the `TimeoutError`.

## 11. `Reader.read` returns an empty Binary at the end after an empty chunk

`fill` in `std/io.lerta` takes an empty chunk as data, so when a `read_chunk` returns an empty Binary and then nil, `read` returns an empty Binary in place of nil. The runtime never gives an empty chunk, so only a `read_chunk` of the program's own does this.

The fix is for `fill` to skip an empty chunk.

## 12. `while` does not narrow in its body

`check_while` in `compiler/checker/loop.lerta` checks the condition but does not narrow by it, so `while m != nil` followed by `m.v` is rejected with `type Node? has no property 'v'`. [The reference](reference/control-flow.md) does not list `while` among the places that narrow.

The fix is to narrow the body by the condition, as `if` does, and to add `while` to the reference.

## 13. Testing a weak local for nil does not say why it is not narrowed

A weak local is not narrowed, as the reference says, but after `if w != nil`, `w.n` reports only `type C? has no property 'n'`.

The fix is to add that `w` is weak and can be taken with `if alive := w`.

## 14. The reference says an enum cannot be a member of a union

[The reference](reference/types.md) says an enum cannot be a member of a union so far, but the checker accepts `type K = Color | Int`, and `case` and `to_string` work on it.

The fix is to remove the sentence.

## 15. `LertaPrefix` is aligned to 16 but placed at 8

In the debug runtime, `LertaPrefix` in `runtime/internal.h` is declared `_Alignas(16)`, but the allocator places objects at multiples of 8, so half of the prefixes are not aligned to 16. A compiler may use aligned 16-byte instructions on them; clang 21 on x86-64 does not today.

The fix is to align it to 8.

## 16. `read_console` underflows when given fewer than 3 bytes

In `runtime/platform_windows.c`, `read_console` reads `size / 3` UTF-16 units. With `size` below 3 and a high surrogate held from the last read, `fitting - start` is -1, and `ReadConsoleW` is asked for about 4 billion units into an 8192-unit buffer. `lerta_stdin_read` always passes 65536, so this cannot happen today.

The fix is to read at least one unit beyond the held surrogate.

## 17. `read_console` loops when the input ends after a held high surrogate

In `runtime/platform_windows.c`, when `read_console` holds a high surrogate and `ReadConsoleW` then reads nothing, the check for the end sees the held unit, holds it again and reads again, without end. The check for Ctrl-Z also looks at `wide[0]`, the held unit, in place of `wide[start]`. This is found by reading the code, not by running it.

The fix is to end when nothing is read, and to look at `wide[start]` for Ctrl-Z.
