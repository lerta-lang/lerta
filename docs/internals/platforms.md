# Input, output and platforms

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
- **UDP.** A `UdpSocket` holds a `Udp` of `runtime/udp.c`, which holds its libuv handle, as a `Handle` does its stream, and is freed as one is.
  - A receive stops libuv's receives at the first datagram, as a read does, into a buffer of the `Udp` that any datagram fits. Its sender is kept in the `Udp` for `std:net` to read, as a promise gives one value.
  - A send parses a numeric host at once (`uv_ip4_addr`, `uv_ip6_addr`), and resolves a name on the thread pool unless it is the name, and the port, that the `Udp` resolved last, within a second.
- **HTTP timeouts.** The timeouts of a connection that `serve` of `std:http` serves, one wait after another, go through a `Deadline` of `std/internal/deadline.lerta` rather than `timeout` of `std:async`, whose sleep and race for each read were a tenth of the server's time.
  - One sleep watches them, until the deadline set, or without end while none is set; a deadline sooner than its wake cancels it to wake then.
  - Over a connection kept alive, it sleeps a few times for each idle timeout, however many requests come meanwhile.
- **SIGPIPE.** On POSIX, SIGPIPE is ignored, as libuv's writes to a socket would raise it on Linux. `lerta_os_write`, which writes stdout and stderr, raises it itself on `EPIPE`, with its default action, so that those still end the program as the signal did (see [std:io](../reference/std.md#stdio)). libuv gives the programs that `run` starts the default disposition of each signal.


## Platforms

- Targets are Linux, macOS and **Windows**. No POSIX-specific assumptions from the start: OS dependencies are confined to the boundary of libuv and the runtime.
- How the tests cover other targets, on other machines or in Docker, is in the [README](../../README.md#testing-other-targets).

### Platform functions

- In the runtime, what differs between systems is a small set of functions, declared together in `runtime/internal.h`:
  - `runtime/platform.c` implements those that libuv makes the same on every system, through its synchronous file system calls and its functions of the system.
  - `runtime/platform_posix.c` and `runtime/platform_windows.c` implement the rest, which libuv lacks, or has not synchronously, or not as the runtime needs: the stack and the memory, the standard streams, the arguments, the file of the command of `run`, how the program ends, the system's name (which libuv tells as Linux under Wine), and the copy of a file (libuv's copy removes the file it was replacing if it fails, and copies the size that the file had when it began).
- The compiler compiles of the `platform_*.c` files only those that `runtime/<system>.mk` lists for the system, so no file of the runtime tests the system with the preprocessor. The rest of the runtime is shared and calls no system functions.

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
- The compiler carries libuv's sources as it does the runtime's, and compiles them into the runtime's cache for each target, with the flags and the system's libraries that `runtime/<system>.mk` lists for its system, taken from libuv's CMakeLists.txt. Its warnings are silenced, as they are not the program's.
- The runtime's own files take only libuv's headers, which ask nothing more of their users, so that libuv's feature macros, such as `_FILE_OFFSET_BITS`, do not change what the runtime sees.
- Its object files are linked as they are, with no archive: an optimized build drops what the program does not use, through `-flto`, and an unoptimized one holds all of libuv, whose size does not matter there.
- A system's libuv is not used instead:
  - the distributions' packages lag behind (Debian bookworm's is 1.44);
  - none provides one for mingw-w64 off Windows;
  - a shared one would make programs depend on it;
  - it would not make the optimized build faster either (see [inlining the runtime](architecture.md#inlining-the-runtime)).
- The [event loop](iteration.md#the-event-loop) runs on it, which absorbs the platform differences of what waits.
