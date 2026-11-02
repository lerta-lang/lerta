# Issues

Known defects. Each says where it is, how to see it and how to fix it. An issue marked *unverified* was found by reading the code and has not been reproduced.

## `case` with value patterns is rejected on a local narrowed from a union

Severity: Low.

`check_patterns` (compiler/checker/case_patterns.lerta:41-43) chooses type patterns whenever the subject's *declared* type is a union, although after `if x is Int` the subject's type is `Int` and a `case` on an `Int` takes value patterns.

```
f := (x: Int | String) ->
  if x is Int
    case x
      when 1 then print 'one'
      else print 'other'
f 1
```

Reported: `a pattern of a case on types names a type so far; test the others with 'is'`. Expected: prints `one`.

Fix: choose type patterns from the subject's current type (`inner_of(subject_type) is UnionType`), and use the declared type only to validate which types the patterns may name.

## A compound index assignment leaks an owned array when the operator throws

Severity: Low.

`generate_index_assignment` (compiler/codegen/assignment.lerta:118-119) pops the temporaries that hold the array and the value before `combine`, whose checked arithmetic can throw; the unwind then no longer releases the array.

```
get := (): Int[] -> [9223372036854775807]
try
  get()[0] += 1
catch e: ArithmeticError
  print e.message
```

With the debug runtime: `integer overflow`, then `leak: 1 object(s)`, exit 23. A borrowed array (`xs[0] += 1`) and the out-of-range path are clean.

Fix: pop the temporaries after `combine`.

## `copy_file` opens its files without `O_CLOEXEC`

Severity: Low.

runtime/platform_posix.c:134 and :138 open the source and the destination with raw `open()` and no `O_CLOEXEC`; everything else the runtime opens is close-on-exec. libuv's child setup on Linux closes no descriptors above 2, so a `run` that overlaps a `copy_file` gives the child a readable descriptor on the source and a writable one on the destination. macOS spawns with `POSIX_SPAWN_CLOEXEC_DEFAULT`, which hides it. *Unverified* on Linux.

Fix: add `O_CLOEXEC` to both `open` calls.

## `copy_file` copies the setuid, setgid and sticky bits and ignores the umask

Severity: Low.

runtime/platform_posix.c:143 does `fchmod(out, found.st_mode & 07777)`. As an ordinary user the kernel strips the setuid and setgid bits on write (observed: a `6755` source gives a `755` copy), but as root they persist, so copying a file whose mode an attacker controls into a trusted place makes a setuid root file; `cp` clears them. The umask is not applied either: a `0666` source gives a `0666` copy. [std](reference/std.md) says only that the copy takes the permissions of the file.

Fix: `found.st_mode & 0777`, and say so in std.md.

## `remove_tree` follows a directory replaced by a symlink mid-walk

Severity: Low.

`lerta_os_remove_tree` (runtime/platform.c:204-224) decides the kind with `uv_fs_lstat` (:206), then resolves the path with `lerta_os_real_path` (:216) and descends by path; each child repeats the pair. A directory swapped for a symlink between the two calls is followed, and the target's entries are removed. *Unverified* race; it needs an attacker who can write to the tree being removed, such as a shared temporary directory.

Fix: walk with descriptor-relative calls in platform_posix.c (`openat` with `O_NOFOLLOW | O_DIRECTORY`, `fdopendir`, `unlinkat`), or at least `fstat` the opened directory and compare `st_dev` and `st_ino` with the `lstat` before descending.

## `read_file` reads special files without limit

Severity: Low.

`lerta_os_read_file` (runtime/platform.c) opens anything, and its `read_chunks` doubles its buffer until `realloc` fails. `read_file('/dev/zero')` grows until the allocator fails and the program panics `out of memory`, not a catchable `IOError`; a FIFO without a writer blocks one of libuv's four pool threads forever. `copy_file` already refuses a source that is not a regular file. *Unverified* by running, since it would take all memory.

Fix: `fstat` after opening and fail with an `IOError` unless the file is regular, or document and enforce a size cap.

## The HTTP server accepts control characters in the method and the target

Severity: Low.

The request line is only split into three words (std/internal/http_request.lerta:40-43) and the method is not checked with `is_token`; `url_of` (:141-144) accepts any non-whitespace UTF-8 in the target. `GET /a\x01b HTTP/1.1` is answered 200 with `request.url` holding the control character, and `G\x7fT / HTTP/1.1` is answered 200 with that method; RFC 9112 requires 400 for both. The server reflects neither into its own response, but the handler and any log or proxy get them. `Host: hé` is accepted too, though a host must be ASCII.

Fix: `throw bad_request()` when the method is not a token or the target holds a character at or below 0x20 or equal to 0x7F.

## A `Date` field pushed into `fields` with a capital letter gets a second `Date`

Severity: Low.

std/internal/http_response.lerta:19-22 compares the framing fields by `name.to_lower()` but checks `'date' not in response.headers`, whose `get_all` compares the stored name as written. A handler that pushes `('Date', ...)` into `headers.fields` directly, bypassing `Headers.set`, sends two `Date` fields.

Fix: compare lowercased names in that check too.

## The HTTP client skips a response whose status is below 100 as informational

Severity: Low.

`read_any_head` checks only that the status has three digits (std/internal/http_client.lerta:275), and the loop at :253 skips every status below 200. A server that sends `HTTP/1.1 099 Early` and then a 200 gets `200 ok` from `fetch`; expected: `a malformed response`.

Fix: `throw malformed() if status < 100`.

## Non-ASCII characters in a URL are written raw into the request line

Severity: Low.

`parse_url` rejects only characters at or below 0x20 and 0x7F (std/internal/http_client.lerta:194), so `fetch("http://h/café")` sends `GET /café HTTP/1.1` with the raw UTF-8 bytes, which RFC 9112 forbids and many servers answer with 400; a `Location` with such characters is followed likewise (:230). No injection is possible, since CR, LF and space are rejected.

Fix: percent-encode bytes at or above 0x80 in the path and query, or reject them.

## `encode_json` is quadratic in the depth of a self-referential structure

Severity: Low.

`enter` (std/internal/json_writer.lerta:55-60) searches `@entered` linearly and builds the whole path text for every object entered. Encoding a chain of `class Node` with `next: Node?` takes 2 s for 10,000 nodes, 7.8 s for 20,000 and 31 s for 40,000.

Fix: keep `entered` as a `Set<Int>`, and build the path text only when a cycle is found.

## Parsing a long call without parentheses is quadratic

Severity: Low.

`command_callee_length` (compiler/parser/statement.lerta:357-368) calls `peek_at(length)` for a growing `length`, and `index_at` (compiler/parser/token_stream.lerta:75-78) walks `offset` steps each time. A callee of 60,000 members on one line takes 17 s to parse, one of 100,000 takes 48 s.

Fix: scan with a local index and `index_after`, as `closing_offset` does.

## `lerta fmt` is quadratic in the length of an `else if` chain

Severity: Low.

`if_doc` (compiler/format/print_control.lerta:67-80) recurses per arm, and `statement_if_postfix` calls `block_has_comments` (compiler/format/source.lerta:38-63), which scans to the end of the whole chain, at every level. A chain of 2,000 arms formats in 0.6 s, 5,000 in 5 s, 10,000 in 23 s; 5,000 separate `if`s take 0.2 s.

Fix: compute the comment lines of each block once, such as a sorted array of comment lines and a table of block ends per indent.

## A `#` inside an interpolation silently starts a comment

Severity: Low.

`find_interpolation_end` (compiler/lexer/string_literal.lerta:166-194) treats a `#` not followed by `{` as code, and `tokenize_fragment` (compiler/lexer/tokens.lerta:171-179) ignores the scanner's `comment_index`. `print "#{x # }"` compiles and prints `x`; the rest of the interpolation is dropped without a diagnostic, and `fmt` keeps it.

Fix: fail in `tokenize_fragment` when `comment_index` is set, such as `a comment cannot be in an interpolation`.

## `a<b, c>(d)` in an argument list is read as a call with type arguments

Severity: Low.

`starts_type_arguments` (compiler/parser/type.lerta:152-163) accepts `a<b, c>(d)` as a call of `a` with type arguments, although in an argument list two comparisons, `a<b` and `c>(d)`, are a legal reading; [the syntax](reference/syntax.md) covers only `a<b>(c)`. `f(a<b, c>(d))` with `f` taking two `Bool` arguments reports `expected 2 argument(s), got 1`.

Fix: document the rule and point at it from the checker's message, or refuse in `starts_type_arguments` a `,` at depth 0 followed by something that does not start a type.

## `(A | B)?` does not parse

Severity: Low.

`f := (x: (Int | String)?) -> 1` reports `expected '->', found '?'`. [The syntax](reference/syntax.md) documents `(A | B)[]` but not `(A | B)?`; the spelling `Int | String?` works, so this is a gap in the type syntax, not an unsoundness.

Fix: accept `?` after a parenthesized type where `[]` is accepted, or document that an optional union is written `A | B?`.

## `lerta fmt` moves the parameters of a function literal argument after a comment

Severity: Low.

A function literal argument with parameters after a comment on a line of its own is written apart from its parameters:

```
run := (f: (Int) -> void) -> f(1)
f := ->
  run(
    # c
    (n) -> print n
  )
f()
```

`lerta fmt --fix` writes `run (`, `# c`, `n`, `) -> print(n)`, which parses as the same program, and `lerta fmt` reports `Long lists` and `Function bodies` at columns that do not hold what they name. One before a parameterless `->` is reported instead (see stranded_comments in compiler/format/source.lerta).

Fix: report such a comment as stranded too, or place it before the literal's `(`.

## `lerta fmt` breaks a multi-line `case` inside an index

Severity: Low.

An index whose position is a `case` on lines of its own compiles and runs, but `lerta fmt` prints it as code that does not parse, and reports that instead of formatting the file:

```
print boxes[
  case
    when replacing
      boxes = [Box('second')]
      0
    else 0
].name
```

`lerta fmt` reports `expected end of line, found ']'`. `tests/call/borrowed_values.lerta` keeps such an index with `# fmt: skip`.

## The language server answers an internal error to a completion at a negative line

Severity: Low.

`source_position` (compiler/lsp/diagnostics.lerta:98-107) turns LSP line `-1` into source line 0, and `completion` (compiler/lsp/server.lerta:244-247) indexes `lines[at.line - 1]`, which throws; the server answers `-32603 index out of range` and prints it to stderr. Hover and definition at the same position return `null`.

Fix: return none when `at.line < 1`, or reject negative positions in `source_position`.

## The language server matches `Content-Length` case-sensitively

Severity: Low.

compiler/lsp/protocol.lerta:55 uses `line.without_prefix('Content-Length:')`; header names are case-insensitive, and `printf 'content-length: 2\r\n\r\n{}' | bin/lerta lsp` ends the server with `an LSP message without its Content-Length`, exit 1.

Fix: split on the first `:` and compare the lowercased name.

## The language server reads `file://host/path` as a relative path

Severity: Low.

`path_of_uri` (compiler/lsp/uri.lerta:7-10) strips `file://` and keeps the rest, so the host of `file://localhost/a/b.lerta`, which RFC 8089 allows, becomes the first path component. The document is then treated as not a file: no diagnostics, `null` from hover and definition, `[]` from formatting.

Fix: after `file://`, when the rest does not start with `/`, drop an empty or `localhost` authority, and return nil for any other host.

## The VS Code extension stops reading a server after one message without a header

Severity: Low.

editors/vscode/extension.js:29-40 takes `Number(...)` of a `Content-Length` match, which is `NaN` when there is none, so the length guard passes and `JSON.parse` throws inside the `data` handler before `buffer` advances. Every later `data` event parses the same bytes and throws again; the server is never marked ended, no error is shown and documents stay attached to it. Reached when `lerta.path` names a program that writes anything else to stdout. *Unverified* in VS Code.

Fix: end the server and kill the child when the header does not match; parse inside `try`, and advance `buffer` regardless.

## The runtime cache names an entry by a 32-bit hash

Severity: Low.

`runtime_hash` (compiler/runtime_cache.lerta:154, 179-192) is a polynomial hash modulo a 32-bit prime, printed as 8 hex digits, and it is the only content-dependent part of a runtime directory's name. The key covers the clang version, the flags, the file names and the runtime and libuv sources, so a stale runtime takes a collision, but a collision links the wrong objects silently.

Fix: widen to 64 bits and print 16 hex digits.

## Linked files come after `-lm` and libuv's libraries on the link line

Severity: Low.

*Unverified*. compiler/build.lerta:98-108 puts the user's linked files after the `-l` libraries. ld64 does not care, but GNU ld with `--as-needed`, which Debian's and Ubuntu's toolchains pass, drops a library that nothing before it needs, so a linked `.c` or `.o` that calls libm gets an undefined reference.

Fix: put the linked files before the libraries.

## The test driver leaves its work directory when a module's top level throws

Severity: Low.

`work_root := make_temp_dir()` runs when test/lib/lerta.lerta is imported (:32), and test/lib/cli.lerta runs clang at import (:39-41) and reads a file (:46). The only `remove_work_root` is the `finally` around `main()` in test/main.lerta:152-157, so an exception at import leaves the directory. `TMPDIR=<empty dir> PATH=/nonexistent bin/test --list` prints `cannot run: clang`, exits 1 and leaves `<empty dir>/lerta-XXXXXX/{cache,run}`.

Fix: compute the clang probe and the hello output on first use, or make `work_root` on first use in `suite_dir`.

## The cli, format, leaks and self suites run the compiler without a timeout

Severity: Low.

`run_command` (test/lib/cli.lerta:26-36), `run_file` (test/lib/lerta.lerta:57-66), test/format.lerta:16, test/leaks.lerta:43-44 and test/self.lerta:44-55 await `run(...)` with no `timeout`, while test/run.lerta:252 and the runtime suite have one. A compiler that hangs, such as `lerta lsp` not exiting or a looping formatter, blocks a worker, and with all workers blocked `make test` never ends. *Unverified* by running.

Fix: wrap them in `timeout(..., N)` as `run_program` does, throwing `SetupError`.

## `expect_unchanged` in the format suite compares modification times written moments apart

Severity: Low.

test/format.lerta:64-67, used at :237-247, writes files, runs `fmt --fix` at once and takes `stat(path).modified_time == time` as proof that the files were not rewritten. On a filesystem with one-second timestamps a rewrite within the same second passes. APFS and ext4 have nanosecond timestamps, so the check works there.

Fix: compare the inode or change time as well, or set the modification time back to a known value before running `fmt`.

## The benchmarks and the test reports measure with `time()` instead of `monotonic()`

Severity: Low.

bench/run.lerta:64-66 and test/lib/report.lerta:77 take durations from `time()`, which [std](reference/std.md) says may go back when the clock is set back, and provides `monotonic()` for. A clock step during `make bench` gives a wrong or negative sample, which `best` takes as the minimum, and a negative product can make the geometric mean throw. *Unverified*: it takes a clock step during a run.

Fix: use `monotonic()` in both.
