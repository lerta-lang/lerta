#ifndef LERTA_INTERNAL_H
#define LERTA_INTERNAL_H

// What only the runtime's own C code uses; lerta.h declares what the generated code, std and the C
// files linked with a program use.
#include <string.h>

#include "lerta.h"

// Memory (memory.c).
#ifdef LERTA_DEBUG
// Gives the visitor each object queued to be dropped.
void lerta_visit_pending(LertaVisitor visitor);
#endif
// malloc, realloc and calloc that panic when out of memory instead of returning NULL.
void *lerta_checked_malloc(size_t size);
void *lerta_checked_realloc(void *memory, size_t size);
void *lerta_checked_calloc(size_t count, size_t size);
// Moves a buffer of `capacity` items from malloc to one of twice as many, or of `first` if it has
// none, and sets `capacity` to that.
void *lerta_grow_buffer(void *items, int64_t *capacity, size_t item_size, int64_t first);
// A queue of items of one size, in a buffer from malloc: those from `start` up to `end`.
typedef struct {
  uint8_t *items;
  int64_t start;
  int64_t end;
  int64_t capacity;
} LertaQueue;
// The place of a new item at the end, which the caller fills. The items shifted from the front are
// dropped before the queue grows.
static inline void *lerta_queue_push(LertaQueue *queue, size_t item_size) {
  if (queue->end == queue->capacity && queue->start > 0) {
    int64_t length = queue->end - queue->start;
    memmove(queue->items, queue->items + queue->start * (int64_t)item_size,
            (size_t)length * item_size);
    queue->start = 0;
    queue->end = length;
  }
  if (queue->end == queue->capacity) {
    queue->items = lerta_grow_buffer(queue->items, &queue->capacity, item_size, 16);
  }
  return queue->items + queue->end++ * (int64_t)item_size;
}
// The place of the first item, or NULL if the queue is empty, which a push may move.
static inline void *lerta_queue_front(const LertaQueue *queue, size_t item_size) {
  if (queue->start == queue->end) return NULL;
  return queue->items + queue->start * (int64_t)item_size;
}
static inline void lerta_queue_shift(LertaQueue *queue) { queue->start++; }
// The allocator (allocator.c), which frees with no size, and NULL as free does.
void *lerta_mem_alloc(int64_t size);
void lerta_mem_free(void *memory);
// The bytes that the place of `memory` holds, which may be more than were asked for.
int64_t lerta_mem_capacity(void *memory);
// Keeps the place when it holds `size` bytes and is not more than twice as large; else moves what
// it holds, as far as it fits, to a new one. NULL is none.
void *lerta_mem_realloc(void *memory, int64_t size);
// The fewest empty slabs that a release build keeps undiscarded (see end_round_if_due), and the
// most that a debug build keeps (see keep_empty_slab).
#define EMPTY_SLABS_KEPT 4
// The slabs given to a size class, the empty ones kept for reuse, and those of them discarded, for
// the runtime checks.
void lerta_mem_slab_counts(int64_t *in_use, int64_t *empty, int64_t *discarded);

// The leak check (leaks.c), of the debug runtime, as the program ends: of what is left alive, and,
// as `exit` ends it, which holds what is still in use, of the objects that nothing in use holds.
// Each returns whether it reported any, which ends the program with LERTA_LEAK_EXIT_CODE.
bool lerta_report_leaks(void);
bool lerta_report_unreachable(void);
// Apart from the codes that the runtime and the compiler use, so that a leak is told from them; a
// program may still exit with it itself.
#define LERTA_LEAK_EXIT_CODE 23
#ifdef LERTA_DEBUG
// What the debug runtime keeps before each object, by which the leak check tracks it. Its size is a
// multiple of 8, even where pointers are 4 bytes, so that the object after it keeps the alignment
// to 8 that the allocator gives.
typedef struct LertaPrefix {
  _Alignas(8) struct LertaPrefix *previous;
  struct LertaPrefix *next;
} LertaPrefix;
_Static_assert(sizeof(LertaPrefix) % 8 == 0, "a LertaPrefix keeps its object aligned to 8");
// Adds an object, by its prefix, to the objects alive, as it is made, and takes it away as it is
// freed; and counts the frames of coroutines alive likewise, which have no prefix.
void lerta_track(LertaPrefix *prefix);
void lerta_untrack(LertaPrefix *prefix);
void lerta_track_frame(void);
void lerta_untrack_frame(void);
#endif

// Gives an object that no other holds room for `size` bytes, keeping its place when it has the
// room, else moving it to one of twice the size, so that growing it step by step copies it
// O(log n) times. The caller ensures that no weak box or trace knows the object by its place.
void *lerta_grow(void *object, int64_t size);
// Whether the object's place has room for `size` bytes, so that lerta_grow keeps it there.
bool lerta_has_room(void *object, int64_t size);

// Strings (string.c). A new string or Binary value whose bytes the caller fills.
LertaString *lerta_string_new(int64_t length);
enum { LERTA_INT_TEXT_MAX = 20 };  // 19 digits and a sign
// Writes the decimal text of n at the end of buffer and returns where it starts.
int64_t lerta_format_int(int64_t n, uint8_t buffer[LERTA_INT_TEXT_MAX]);
// The string as a NUL-terminated C string, which the caller frees. It must hold no NUL byte, which
// C would take as its end: std refuses those first.
char *lerta_c_string(const LertaString *s);
// Calls `call` with both strings as C strings, as lerta_c_string makes them, and frees them after.
bool lerta_with_c_strings(const LertaString *a, const LertaString *b,
                          bool (*call)(const char *a, const char *b));
// The String of the C string's bytes, which end at its NUL.
LertaString *lerta_string_from_c(const char *text);
// As lerta_string_from_c, of a C string that the platform allocated, which it frees; NULL if it is
// NULL.
LertaString *lerta_string_from_os(char *text);
// Appends the C string to an array of strings, as a new string.
void lerta_append_c_string(LertaArray *array, const char *text);

// Items (array.c): the size of an item of the kind, and the counting of the reference it holds.
int64_t lerta_item_size(LertaItemKind kind);
void lerta_retain_item(LertaItemKind kind, const void *item);
void lerta_release_item(LertaItemKind kind, const void *item);
void lerta_visit_item(LertaItemKind kind, const void *item, LertaVisitor visitor);
// The item at the index of an array of any kind but interface values, as 8 bytes: an integer item
// is extended by its sign, as the generated code widens it, and an optional item is its address.
int64_t lerta_word_item(const LertaArray *array, int64_t index);
// Arrays (array.c): the generated code pushes in place.
void lerta_array_append(LertaArray *array, const void *item);

// What stops the work that settles a promise, which rejects it with a CancelledError, as
// lerta_promise_reject_cancelled does; it is given `context`.
typedef void (*LertaCancel)(void *context);
void lerta_promise_on_cancel(LertaPromise *promise, LertaCancel cancel, void *context);
void lerta_promise_reject_cancelled(LertaPromise *promise);
// Rejects the promise with an IOError, its message made as by lerta_raise_with.
void lerta_promise_reject_io(LertaPromise *promise, const LertaString *prefix,
                             const LertaString *detail);
// The slot of a settled promise; if it holds an exception, throws it.
void *lerta_promise_result(LertaPromise *promise);

// Addresses (address.c). The text of an address as failures name it, `host:port`, an IPv6 host in
// brackets, as in a URL, so that its port is told from it.
LertaString *lerta_address_text(const char *host, int64_t port);
// The port as getaddrinfo takes it, a service named by its number.
char *lerta_port_text(int64_t port, uint8_t buffer[LERTA_INT_TEXT_MAX + 1]);
struct sockaddr_storage;
int64_t lerta_port_of(const struct sockaddr_storage *address);
// Writes the numeric host of the address into `host`, of INET6_ADDRSTRLEN bytes; false if it cannot.
bool lerta_host_of(const struct sockaddr_storage *address, char *host);

// The libuv stream of a handle (handle.c), for a program that runs to read or write.
struct uv_stream_s *lerta_handle_stream(int64_t pointer);
// The event loop (loop.c). Waits for what settles promises, and settles them, once; false, without
// waiting, if nothing is left to wait for.
bool lerta_loop_wait(void);
// The signals that ask the program to end cancel the top-level code, once it awaits, until it is
// settled and they are unwatched; lerta_signal_received gives the signal, or 0, and
// lerta_end_by_signal ends the program by it, after its output.
void lerta_signals_watch(LertaPromise *top_level);
void lerta_signals_unwatch(void);
int lerta_signal_received(void);
_Noreturn void lerta_end_by_signal(void);
// Runs `work` on libuv's thread pool, then `done` on the loop, both with `data`. `work` must not
// touch what the main thread does, such as Lerta's allocator.
void lerta_loop_work(void *data, void (*work)(void *data), void (*done)(void *data));

// Reads and writes (platform*.c, handle.c): the most bytes that one asks for at once, 1 GiB, as
// macOS rejects one of more than INT_MAX bytes, and Windows and libuv's buffers there count their
// bytes in 32 bits.
#define LERTA_IO_CHUNK ((int64_t)1 << 30)
static inline int64_t lerta_io_chunk(int64_t length) {
  return length < LERTA_IO_CHUNK ? length : LERTA_IO_CHUNK;
}

// Process (process.c): main's arguments, without the program name.
void lerta_set_arguments(int argc, char **argv);

// Output (output.c), buffered for stdout and stderr together (see
// docs/internals/platforms.md#output).
enum { STDOUT_FD = 1, STDERR_FD = 2 };
void lerta_output_init(void);
// Appends the bytes for STDOUT_FD or STDERR_FD. The promise is rejected at once if the stream has
// failed, resolved at once if the buffer stays under its limit, and otherwise settled once they
// are written out.
LertaPromise *lerta_output_write(int fd, const uint8_t *bytes, int64_t length);
// A promise settled once all that was written to the buffer so far is written out; rejected if
// the stream has failed.
LertaPromise *lerta_output_wait(int fd);
// Writes at once, after writing out the buffer and settling its promises as lerta_output_flush
// does, remembering a failure as a write out does.
void lerta_output_write_now(int fd, const uint8_t *bytes, int64_t length);
// Writes out what the buffer holds, waiting for a write out in flight, and settles the promises of
// the writes.
void lerta_output_flush(void);
// The same, for a program that ends, which settles no promise: settling one may throw, and the end
// may come while an exception is pending. A panic does not lock (see output.c). Returns false if
// any output to stdout has failed.
bool lerta_output_flush_at_end(bool panicking);
// Writes to stderr at once, for reports, whose failure cannot be reported (io.c).
void lerta_stderr_write(const uint8_t *bytes, int64_t length);
void lerta_stderr_write_text(const char *text);
void lerta_stderr_write_string(const LertaString *s);
void lerta_stderr_write_int(int64_t n);

// Errors (errors.c, lerta.c). The message of the pending exception, owned, which the first entry of
// an Error's itab gives.
LertaString *lerta_exception_message(void);
// Prints the pending exception's message and trace to stderr, after flushing stdout, and exits with
// status 1.
_Noreturn void lerta_exit_with_exception(void);
// Called as an object is freed: a trace of it is of no exception any more, so that one made later
// at its address starts its own.
void lerta_trace_forget(void *object);
// Makes the saved trace the current one, keeping it (see lerta_trace_restore).
void lerta_trace_load(const LertaTrace *saved);
// As lerta_raise, with the message made of a prefix, a LertaString such as a LERTA_STATIC_STRING,
// and the detail.
void lerta_raise_with(LertaErrorKind kind, const LertaString *prefix, const LertaString *detail);
// An IndexError of an index out of range, as of an array or a Binary.
void lerta_raise_index_out_of_range(void);
// Prints the message to stderr and exits with status 1: for an uncaught exception, and for an
// error raised without a raise function.
_Noreturn void lerta_exit_with_error(const LertaString *message);
_Noreturn void lerta_panic(const char *message);
_Noreturn void lerta_panic_with(const char *prefix, const LertaString *message);
// Panics with the prefix and the pending exception's message, and its trace.
_Noreturn void lerta_panic_with_exception(const char *prefix);

// What differs between systems (see docs/internals/platforms.md#platforms): platform.c implements
// through libuv what it can, and platform_posix.c or platform_windows.c the rest. Paths and
// arguments are NUL-terminated UTF-8, and a false or NULL result is a failure.
// Stack overflow: reported as a panic. Called first thing in main.
void lerta_stack_init(void);
// The seed and the secret of lerta_string_hash: lerta_hash_init makes the seed random for each
// process, and lerta_string_hash makes the secret from it at its first call, as wyhash's make_secret
// does (lerta_make_hash_secret); the secret is all 0 until then.
extern uint64_t lerta_hash_seed;
extern uint64_t lerta_hash_secret[4];
void lerta_make_hash_secret(uint64_t seed, uint64_t secret[4]);
void lerta_hash_init(void);
// Gives main's arguments as the system's bytes, which are UTF-8 on Windows: POSIX leaves them as
// they are, and Windows replaces them with ones read from its UTF-16 command line.
void lerta_os_arguments(int *argc, char ***argv);
// Writes all the bytes to stdout (1) or stderr (2); on POSIX, to any file descriptor.
bool lerta_os_write(int fd, const uint8_t *bytes, int64_t length);
// Has a write of lerta_os_write to a pipe whose reader is gone end the program, as SIGPIPE does by
// default on POSIX, whatever the parent left it as (see docs/reference/std.md#stdio), while one to
// a socket fails; Windows has no such signal. A closed stdin reads as empty.
void lerta_os_stdio_init(void);
// Seconds since the Unix epoch, 1970-01-01T00:00:00Z.
double lerta_os_unix_time(void);
// The seconds that local time, as TZ or else the system sets it, is ahead of UTC at the seconds
// since the Unix epoch; INT64_MIN for a time that the system cannot convert.
int64_t lerta_os_utc_offset(int64_t seconds);
// Ends the program at once, without flushing stdout.
_Noreturn void lerta_os_exit(int code);
// Whether the parent left the signal ignored; never on Windows.
bool lerta_os_signal_ignored(int signal_number);
// Ends the program as the signal does by default, which the parent sees; on Windows, with the code
// 128 plus its number, as std:process gives a signal.
_Noreturn void lerta_os_end_by_signal(int signal_number);
// Ends the program as a failure that is not an exit code, as C's abort does.
_Noreturn void lerta_os_abort(void);
// Memory from the system for the allocator (allocator.c): `size` bytes, a multiple of
// LERTA_REGION_SIZE, aligned to it, or NULL; and back to the system. A region discarded stays
// mapped, but the system may take its pages, so that what it held is undefined until written again.
#define LERTA_REGION_SIZE ((int64_t)1 << 16)
void *lerta_os_map_region(int64_t size);
void lerta_os_unmap_region(void *region, int64_t size);
void lerta_os_discard_region(void *region, int64_t size);
// The bytes of the file, which the caller frees, and their count in `length`, or NULL on failure,
// with LERTA_OUT_OF_MEMORY in `length` if memory ran out; `length` is left as it is if the file
// cannot be opened, so the caller sets it first. It allocates with malloc and does not panic, so a
// worker may call it; the caller panics.
// Not -1, which a read gives on failure.
enum { LERTA_OUT_OF_MEMORY = -2 };
uint8_t *lerta_os_read_file(const char *path, int64_t *length);
// Reads what stdin has, up to `size` bytes, waiting for some: their count, 0 at the end, or -1 on
// failure. `size` is at least LERTA_STDIN_MIN_READ, which a read of a Windows console needs (see
// read_console).
#define LERTA_STDIN_MIN_READ 6
int64_t lerta_os_read_stdin(uint8_t *buffer, int64_t size);
bool lerta_os_write_file(const char *path, const uint8_t *bytes, int64_t length);
// A file opened for writing, emptied or made, as lerta_os_write_file opens it, or a negative number
// on failure; the writes give their places in it, so that two at once do not race for the position.
int64_t lerta_os_open_for_writing(const char *path);
bool lerta_os_write_at(int64_t file, int64_t offset, const uint8_t *bytes, int64_t length);
void lerta_os_close(int64_t file);
// What lerta_os_stat writes of what a path names: its kind, its size in bytes and the time it was
// last modified, in nanoseconds since the Unix epoch.
enum { LERTA_FILE_KIND, LERTA_DIR_KIND, LERTA_OTHER_KIND };
typedef struct {
  int64_t kind;
  int64_t size;
  int64_t modified_time;
} LertaFileStatus;
// The status of what the path names, through symbolic links: 1 if it is there, 0 if nothing is,
// as for a dangling link, and -1 if it cannot be read.
int lerta_os_stat(const char *path, LertaFileStatus *status);
// Makes a symbolic link at `path` to `target`, written as it is.
bool lerta_os_make_link(const char *target, const char *path);
// Copies the contents of a file, replacing a file at `to`.
bool lerta_os_copy_file(const char *from, const char *to);
// Appends the names of the entries of the directory, without `.` and `..`, in no order, to the
// array of Binaries.
bool lerta_os_list_dir(const char *path, LertaArray *names);
// The absolute path with no links, which the caller frees.
char *lerta_os_real_path(const char *path);
// The absolute path of the current directory, which the caller frees, or NULL.
char *lerta_os_current_dir(void);
// A new, empty directory in the system's directory for temporary files, whose path the caller
// frees.
char *lerta_os_make_temp_dir(void);
// Removes a file, or a directory with everything in it; a symbolic link is removed, not followed.
bool lerta_os_remove_tree(const char *path);
// Removes a file, or a link, not what it links to; not a directory, which libuv's unlink refuses on
// every system.
bool lerta_os_remove_file(const char *path);
// lerta_os_remove_tree by paths, as Windows removes a tree (see platform.c).
bool lerta_remove_tree_by_paths(const char *path);
// Makes the directory, whose parent must be there; true if it is a directory afterwards, made now
// or before.
bool lerta_os_make_dir(const char *path);
// Whether the byte separates the directories of a path.
bool lerta_os_is_separator(char c);
// The byte that the system writes between the directories of a path.
char lerta_os_separator(void);
// Moves a file or a directory, replacing a file at `to`.
bool lerta_os_rename(const char *from, const char *to);
// The system's name: linux, macos or windows.
const char *lerta_os_platform(void);
// The number of CPUs that the program may run on, at least 1.
int64_t lerta_os_cpu_count(void);
// The value of an environment variable, which the caller frees, or NULL if it is not set.
char *lerta_os_env(const char *name);
// Appends this program's environment variables to the array, as NAME=VALUE strings.
void lerta_os_environ(LertaArray *entries);
int64_t lerta_os_process_id(void);
// Whether a process with the ID is running; one that the program may not signal is.
bool lerta_os_is_running(int id);
// Whether two names of environment variables name the same variable.
bool lerta_os_same_env_name(const char *a, const char *b);
// The file of a command for a program that run starts, which on Windows is searched for on PATH if
// it holds no directory, as libuv would look in the directory that the program runs in first (see
// docs/reference/std.md#stdprocess); NULL if there is none, or if it is a batch file on Windows.
// The caller frees it.
char *lerta_os_program_file(const char *command);

#endif
