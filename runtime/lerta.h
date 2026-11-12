#ifndef LERTA_H
#define LERTA_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#define LERTA_IMMORTAL INT64_MIN

typedef struct LertaString LertaString;

// Called by a type's visit function with each reference that its object holds, which may be NULL.
typedef void (*LertaVisitor)(void *reference);

// What every object of a type shares: its drop function, which releases what the object owns
// before it is freed, the function that gives the visitor the references it holds, which drop
// releases through it, and the type's name, for the leak check's report. Each type has its own, so
// that it tells the type. An object that holds nothing, as a String, has none.
typedef struct {
  void (*drop)(void *object);
  void (*visit)(void *object, LertaVisitor visitor);
  const LertaString *name;
} LertaType;

typedef struct {
  int64_t ref_count;
  const LertaType *type;
} LertaHeader;

struct LertaString {
  LertaHeader header;
  int64_t length;  // in bytes
  uint8_t bytes[];  // UTF-8 for a String, not NUL-terminated
};

// Marks an array that holds no terminating NUL, which compilers that know the attribute would
// otherwise warn about; older ones do not know it.
#if defined(__has_attribute) && __has_attribute(nonstring)
#define LERTA_NONSTRING __attribute__((nonstring))
#else
#define LERTA_NONSTRING
#endif

// An immortal string constant, as the compiler emits for literals. Like any LertaString, its bytes
// are not NUL-terminated.
#define LERTA_STATIC_STRING(name, text)                     \
  static const struct {                                      \
    LertaHeader header;                                      \
    int64_t length;                                          \
    uint8_t bytes[sizeof(text) - 1] LERTA_NONSTRING;         \
  } name = {{LERTA_IMMORTAL, NULL}, sizeof(text) - 1, text}
// The LertaString of a LERTA_STATIC_STRING.
#define LERTA_STR(name) ((const LertaString *)&(name))

// How arrays and maps hold their items. A plain item is 8 bytes, an Int as is; a reference is 8
// bytes, its address, and is retained while it is held. An interface value is two pointers, its
// data, a reference, then its itab. LERTA_NO_ITEMS take no bytes, as the values of a set, a map
// without values, do. An integer narrower than 8 bytes, a Bool or a Float32's bits, is
// LERTA_INTEGER_ITEMS with its size in bytes in LERTA_ITEM_BYTES, and LERTA_SIGNED_ITEMS if it is
// signed, and takes that size. LERTA_OPTIONAL_ITEMS are optional values that are not references,
// a flag then the value, in the 16 bytes of a LertaItem.
// C moves items only by memcpy, never as a C type: the generated code reads and writes them as a
// type of their own in type-based alias analysis (see compiler/codegen/array.lerta).
typedef enum {
  LERTA_PLAIN_ITEMS,
  LERTA_REFERENCE_ITEMS,
  LERTA_INTERFACE_ITEMS,
  // 3 was the kind of bytes, before the integer items; 4 stays, as the seed's IR passes it.
  LERTA_NO_ITEMS = 4,
  LERTA_OPTIONAL_ITEMS = 5,
  // The mask and the flags of a kind, not kinds.
  LERTA_ITEM_BYTES = 0x0F,
  LERTA_INTEGER_ITEMS = 0x10,
  LERTA_SIGNED_ITEMS = 0x20
} LertaItemKind;

// Room for an item of any kind.
typedef struct {
  int64_t words[2];
} LertaItem;

typedef struct {
  LertaHeader header;
  int64_t length;
  int64_t capacity;
  // Each item takes the size of its kind (see lerta_item_size).
  uint8_t *items;
  LertaItemKind item_kind;
} LertaArray;

// An entry of a map, followed by its value, an item of the map's kind.
typedef struct {
  int64_t key;
  uint64_t hash;
  bool live;
} LertaMapEntry;

// How a map treats its keys (see docs/internals/representation.md#maps). Int keys are words, an
// Int, a UInt64, a Float or an enum, compared as they are; so are integer keys narrower than a
// word, LERTA_INTEGER_KEYS with their size and sign, as in LertaItemKind.
typedef enum {
  LERTA_INT_KEYS,
  LERTA_STRING_KEYS,
  LERTA_OBJECT_KEYS,
  LERTA_VALUE_KEYS,
  LERTA_INTEGER_KEYS = LERTA_INTEGER_ITEMS
} LertaKeyKind;

// The hash and the equality of two items of a type that compares by its contents.
typedef uint64_t (*LertaHash)(int64_t item);
typedef bool (*LertaEquals)(int64_t a, int64_t b);

// See docs/internals/representation.md#maps.
typedef struct {
  LertaHeader header;
  int64_t length;  // live entries
  int64_t entry_count;
  int64_t entry_capacity;
  // The cursors alive, while which the entries stay at their positions (see LertaMapCursor).
  int64_t cursors;
  // Each entry takes the size of an entry and a value (see entry_at in map.c).
  uint8_t *entries;
  int64_t slot_count;  // a power of two
  int64_t *slots;
  LertaKeyKind key_kind;
  LertaItemKind value_kind;
  // For LERTA_VALUE_KEYS only.
  LertaHash hash;
  LertaEquals equals;
} LertaMap;

// The header's fields are spelled out: the generated code lays them out flat, while a nested
// LertaHeader would be padded to the alignment of its int64_t, which is 8 on 32-bit Windows.
typedef struct LertaIter {
  int64_t ref_count;
  const LertaType *type;
  bool (*has_next)(struct LertaIter *iter);
  void *next;
  // Whether a traversal has started; a second one throws.
  bool started;
} LertaIter;

// Memory (memory.c). lerta_new makes an object of the type, which is NULL for one that holds
// nothing. Release frees an object when its count reaches zero. Retain and release accept NULL,
// which is how nil is represented.
void *lerta_new(int64_t size, const LertaType *type);
void lerta_retain(void *object);
void lerta_release(void *object);
// Runs a class's deinit on its object, whose count has reached zero, from its drop function. The
// object counts as referenced once while deinit runs, so that passing it on and releasing it again
// does not drop it twice; deinit must not keep it, which would bring a dropped object back.
void lerta_run_deinit(void *object, void (*deinit)(void *object));
void *lerta_weak_box(void *object, void **slot);
// The object of the box, borrowed, or NULL if it is gone or the box is NULL, as for nil.
void *lerta_weak_object(void *box);
// Called first by the drop function of a class's object, with the place of its box. A box made
// for the object after that, as by its deinit, holds no object.
void lerta_weak_detach(void **slot);

// Strings (string.c). Also the constructors of Binary values, which share the representation.
LertaString *lerta_string_from_bytes(const void *bytes, int64_t length);
// The bits of the double that a float literal's text, such as `1.5e3`, rounds to, which the
// compiler writes into the IR and String.parse_float reads back; -1, the bits of a NaN, which no
// finite double has, if it is too large to be finite.
int64_t lerta_float_literal_bits(const LertaString *text);
// Likewise for a float, given as the bits of the same value as a double, as the IR writes a float
// constant.
int64_t lerta_float32_literal_bits(const LertaString *text);
double lerta_float_from_bits(int64_t bits);
// A Float's text: the fewest digits that read back as it, positional from 1e-4 up to 1e16, with
// `.0` for a whole number, and scientific beyond (`1e+16`), and `inf` or `-inf` for an infinity.
// A Float32's likewise, of the digits that read back as it as a float.
LertaString *lerta_float_to_string(double value);
LertaString *lerta_float32_to_string(float value);

// The seed's to_literal of a Float32 calls it, until the seed is refreshed again.
double lerta_float32_to_float(float value);

// Whether the value truncated toward zero fits in an Int, which only then is it converted to.
bool lerta_float_fits_int(double value);
int64_t lerta_float_to_int(double value);
// Takes `count` borrowed `LertaString *` arguments and returns their concatenation.
LertaString *lerta_string_concat(int64_t count, ...);
// As lerta_string_concat, of arguments that it takes; it extends in place the longest that nothing
// else holds and whose place has room for the result, if any.
LertaString *lerta_string_concat_taken(int64_t count, ...);
// `s + part` and `s + byte` of a String or a Binary, which take `s` and borrow `part`: the bytes
// are appended in place when nothing else holds `s`, so that a loop of `+=` is O(n).
LertaString *lerta_string_extend(LertaString *s, const LertaString *part);
LertaString *lerta_binary_push(LertaString *binary, uint8_t byte);
LertaString *lerta_string_push(LertaString *s, uint32_t c);
bool lerta_string_equals(const LertaString *a, const LertaString *b);
uint64_t lerta_string_hash(const LertaString *s);
// The place of `text` among an enum's `count` member texts, or -1 if none has it (`parse<E>` of
// std:enums).
int64_t lerta_enum_parse(const LertaString *const *texts, int64_t count, const LertaString *text);

// Binary (binary.c): the same representation as String, without the UTF-8 guarantee.
// The bytes from `start` up to, but not including, `end`, copied into a new Binary; throws unless
// 0 <= start <= end <= the length.
LertaString *lerta_binary_slice(const LertaString *binary, int64_t start, int64_t end);
// The bytes of `s` from `start` up to `end`, both at the start of a character or the end of `s`,
// as a new String; else it throws an IndexError.
LertaString *lerta_string_slice(const LertaString *s, int64_t start, int64_t end);
// The same object as a String (retained) if its bytes are valid UTF-8, else NULL.
LertaString *lerta_binary_text(LertaString *binary);
// Arrays (array.c). Items are passed through pointers to them. Items in are borrowed; pop writes
// the item owned.
// The type of every array, whatever its items, which a union tests (see
// docs/internals/representation.md#objects).
extern const LertaType lerta_array_type;
LertaArray *lerta_array_create(LertaItemKind item_kind);
// An array of `length` copies of the item, borrowed, each retained; a negative length throws.
LertaArray *lerta_array_filled(LertaItemKind item_kind, int64_t length, const void *item);
int64_t lerta_array_length(const LertaArray *array);
// A new array of the items from `start` up to `end`, each retained; throws unless
// 0 <= start <= end <= length.
LertaArray *lerta_array_slice(const LertaArray *array, int64_t start, int64_t end);
void lerta_array_take_last(LertaArray *array, void *item);
// These two give all the items, not the one at hand, whose place the generated code computes, as
// only it knows the item size without a branch on the kind (see compiler/codegen/array.lerta).
// The items, if the index is in range; otherwise throws and returns NULL.
uint8_t *lerta_array_checked_items(const LertaArray *array, int64_t index);
// The items, after the array has grown by one item, its last, which the caller then writes.
uint8_t *lerta_array_pushed_items(LertaArray *array);
// Whether two arrays hold equal items in the same order, and a hash of the items in order.
bool lerta_array_equals(const LertaArray *a, const LertaArray *b, LertaEquals equals);
uint64_t lerta_array_hash(const LertaArray *array, LertaHash hash);

// Maps (map.c). Keys and values in are borrowed; values are passed through pointers to them. get
// returns whether the key is there, and writes its value owned (zeros otherwise); keys returns
// them in insertion order. `hash` and `equals` are NULL but for LERTA_VALUE_KEYS.
// The type of every map, as lerta_array_type is of every array.
extern const LertaType lerta_map_type;
LertaMap *lerta_map_create(LertaKeyKind key_kind, LertaItemKind value_kind, LertaHash hash,
                           LertaEquals equals);
int64_t lerta_map_length(const LertaMap *map);
// The place of the key's value, which the generated code reads and writes in place as its type, or
// NULL if the map holds no such key.
void *lerta_map_find(const LertaMap *map, int64_t key);
// The place of the key's value, holding zeros where the map did not hold the key; the map then
// holds the key, retained, and the caller writes the value there, which it retains.
void *lerta_map_place(LertaMap *map, int64_t key);
bool lerta_map_remove(LertaMap *map, int64_t key);

// next writes the key, and the value unless `value` is NULL, both owned, and moves on.
typedef struct LertaMapCursor LertaMapCursor;
LertaMapCursor *lerta_map_cursor(LertaMap *map);
bool lerta_map_cursor_has_next(LertaMapCursor *cursor);
void lerta_map_cursor_next(LertaMapCursor *cursor, int64_t *key, void *value);

// Iters (iter.c). Starting a traversal of an Iter that has started one throws, and so does next
// past the end.
void lerta_iter_start(LertaIter *iter);
void lerta_raise_iter_ended(void);
// Asking an Iter for an item while its function, which yields, runs.
void lerta_raise_iter_running(void);

// Promises and the event loop (async.c).
typedef struct LertaPromise LertaPromise;
LertaPromise *lerta_promise_new(LertaItemKind kind);
// Where the value goes, before lerta_promise_resolve; where it is read once the promise is settled.
void *lerta_promise_slot(LertaPromise *promise);
void lerta_promise_resolve(LertaPromise *promise);
void lerta_promise_reject(LertaPromise *promise);
// For the body of a function that awaits, whose own promise is `own`: whether the coroutine is to
// wait for the promise, which is pending, to be resumed once it is settled; and the slot of the
// settled promise, which throws its exception if it holds one. They record what the body waits
// for, which cancel follows, and the result throws a CancelledError instead if the body's promise
// has been cancelled meanwhile.
bool lerta_promise_wait_in(LertaPromise *promise, void *coroutine, LertaPromise *own);
void *lerta_promise_result_in(LertaPromise *promise, LertaPromise *own);
bool lerta_promise_is_settled(const LertaPromise *promise);
// Cancels the work that the promise waits for (see async.c); nothing if it is settled.
void lerta_promise_cancel(LertaPromise *promise);
// A promise without a value that lerta_promise_fire resolves, unless it is settled already.
LertaPromise *lerta_promise_pending(void);
void lerta_promise_fire(LertaPromise *promise);
// Runs the loop; `resume` resumes a coroutine, which only the generated code can do.
void lerta_loop_run(void (*resume)(void *coroutine));
// Before the loop, the program's top-level code, a coroutine that awaits, whose exception ends the
// program as soon as it throws.
void lerta_watch_top_level(LertaPromise *promise);
// After the loop, the end of that code: an error if it still waits.
void lerta_finish_top_level(LertaPromise *promise);

// Time (time.c). A promise resolved once the milliseconds, which std:time checks are not negative,
// have passed.
LertaPromise *lerta_sleep_milliseconds(int64_t milliseconds);
// Seconds since the Unix epoch, 1970-01-01T00:00:00Z.
double lerta_unix_time(void);
// Seconds since an unspecified time, which only go forward.
double lerta_monotonic_time(void);
// The seconds that local time is ahead of UTC at the seconds since the Unix epoch; INT64_MIN for a
// time that the system cannot convert, which std:time throws for.
int64_t lerta_utc_offset(int64_t seconds);

// Process (process.c). The arguments, without the program's path, and the path; they are Binary
// values, as nothing makes them UTF-8.
LertaArray *lerta_argv(void);
LertaString *lerta_program_path(void);
// Flushes stdout and ends the program; only the objects that nothing in use holds are checked for
// leaks, and a leak ends it with LERTA_LEAK_EXIT_CODE in place of `code`, which std:process checks
// is from 0 to 255.
void lerta_exit(int64_t code);
// A program that runs, which lerta_program_free frees, as it runs on, if it has not ended. It runs
// with the variables of `env`, as NAME=VALUE, if given, and otherwise this program's, in `cwd`, if
// given; its standard input, output and error are the streams of the three handles of `streams`,
// from lerta_pipe_new, or this program's, for 0, or, for -1 minus a file of lerta_system_pipe, that
// file, which it inherits and the caller closes. `args` starts with the command. No text holds a
// NUL byte, which std:process refuses first. 0 if the program cannot start.
int64_t lerta_program_run(const LertaArray *args, const LertaString *cwd, const LertaArray *env,
                          const LertaArray *streams, int64_t kill_after);
// A promise of its exit code, or minus the signal that ended it, settled once it ends; one wait at
// most. A cancel stops the program and rejects the promise once it ends.
LertaPromise *lerta_program_wait(int64_t pointer);
// Asks the program to end, then kills it if it has not ended after `kill_after` milliseconds.
void lerta_program_stop(int64_t pointer);
void lerta_program_free(int64_t pointer);
// Appends the reading and the writing file of a new pipe of the system, both blocking, as the
// programs that inherit them expect, to `files`; throws an IOError on failure.
void lerta_system_pipe(LertaArray *files);
void lerta_file_close(int64_t file);
// Whether two names of environment variables name the same variable.
bool lerta_same_env_name(const LertaString *a, const LertaString *b);
// The system's name: linux, macos or windows.
LertaString *lerta_platform(void);
// The place of the system's name among the `count` texts of an enum's members, which the code of
// a build for no target reads as std's `platform` (see compiler/codegen/enum.lerta).
int64_t lerta_platform_member(const LertaString *const *texts, int64_t count);
// The number of CPUs that are online, at least 1.
int64_t lerta_cpu_count(void);
// Appends this program's environment variables to the array, as NAME=VALUE Binary values.
void lerta_environ(LertaArray *entries);
// The ID of the program's process.
int64_t lerta_process_id(void);
// Whether a process with the ID, from 1 to the largest Int32, which std:process checks, is running.
bool lerta_is_running(int64_t id);
// The value of an environment variable, as a Binary, or NULL if it is not set.
LertaString *lerta_env(const LertaString *name);

// Files (file.c). A failure gives false, NULL or, for lerta_open_file, 0, of which std:io makes the
// error; one that runs on the thread pool gives it through its promise, which only a cancel
// rejects, and an open file's writes through lerta_open_file_failed. No path holds a NUL
// byte, nor is empty for lerta_make_one_dir and lerta_dir_names: std:io refuses those first.
// The promise gives what was read, or NULL.
LertaPromise *lerta_read_file(const LertaString *path);
// The promises of these three give whether they succeeded, as a bool.
LertaPromise *lerta_write_file(const LertaString *path, const LertaString *data);
LertaPromise *lerta_remove_tree(const LertaString *path);
LertaPromise *lerta_copy_file(const LertaString *from, const LertaString *to);
// A file that std:io's open opens for writing, by its address, or 0 (see runtime/file.c).
int64_t lerta_open_file(const LertaString *path);
// Whether a write has failed, after which the later ones fail too.
bool lerta_open_file_failed(int64_t pointer);
// Resolved once written, or once it has failed.
LertaPromise *lerta_open_file_append(int64_t pointer, const LertaString *data);
void lerta_open_file_end(int64_t pointer, const LertaString *rest);
void lerta_open_file_free(int64_t pointer, const LertaString *rest);
// Whether the status of what the path names, through symbolic links, could be read; if the path
// names something, its kind (0 a file, 1 a directory, 2 another), its size and the time it was
// last modified, in nanoseconds since the Unix epoch, are appended to the array of Ints, which
// std:io makes a FileStatus of.
bool lerta_status_fields(const LertaString *path, LertaArray *fields);
bool lerta_symlink(const LertaString *target, const LertaString *path);
// The names of the entries, unchecked and in no order (std:io checks and sorts them).
LertaArray *lerta_dir_names(const LertaString *path);
LertaString *lerta_resolve_path(const LertaString *path);
LertaString *lerta_make_temp_dir(void);
LertaString *lerta_current_dir(void);
// Makes the directory, or finds one there; not its parents.
bool lerta_make_one_dir(const LertaString *path);
bool lerta_remove_file(const LertaString *path);
bool lerta_rename_path(const LertaString *from, const LertaString *to);

// Handles (handle.c), each of a libuv stream, for std:net: one from lerta_tcp_new is a socket or a
// listener, which lerta_handle_free frees, closing it if lerta_handle_close has not. A failure
// throws, or rejects the promise, with an IOError that names the address; so does an operation
// after the close, and the close rejects the read, the accept or the connect pending. No host holds
// a NUL byte, and a port is from 0 to 65535: std:net refuses others first.
int64_t lerta_tcp_new(void);
// A pipe that a program reads or writes, which a failure names by `name`.
int64_t lerta_pipe_new(const LertaString *name);
// A pipe of `file`, a file of lerta_system_pipe, which the handle then holds and closes.
int64_t lerta_pipe_of_file(const LertaString *name, int64_t file);
void lerta_handle_close(int64_t pointer);
void lerta_handle_free(int64_t pointer);
// The port it listens at, which a port 0 leaves to the system.
int64_t lerta_tcp_listen(int64_t pointer, const LertaString *host, int64_t port);
// Resolved once a connection is taken into the new socket, which std:net holds until then. One
// accept is pending at most: another throws a ValueError.
LertaPromise *lerta_tcp_accept(int64_t listener_pointer, int64_t socket_pointer);
LertaPromise *lerta_tcp_connect(int64_t pointer, const LertaString *host, int64_t port);
// A chunk of what has come, as a Binary, or NULL at the end. One read is pending at most.
LertaPromise *lerta_handle_read(int64_t pointer);
// Resolved once the bytes have been handed to the system.
LertaPromise *lerta_handle_write(int64_t pointer, const LertaString *bytes);
// Closes the writing side, once what was written has gone.
void lerta_handle_end(int64_t pointer);

// UDP sockets (udp.c), for std:net, which lerta_udp_free frees, closing it if lerta_udp_close has
// not; failures are as of the handles above, and the close rejects the receive pending.
int64_t lerta_udp_new(void);
void lerta_udp_close(int64_t pointer);
void lerta_udp_free(int64_t pointer);
// The port it is bound at, which a port 0 leaves to the system.
int64_t lerta_udp_bind(int64_t pointer, const LertaString *host, int64_t port);
// The next datagram, as a Binary, whose sender the two functions after give until the next
// receive. One receive is pending at most: another throws a ValueError.
LertaPromise *lerta_udp_receive(int64_t pointer);
LertaString *lerta_udp_sender_host(int64_t pointer);
int64_t lerta_udp_sender_port(int64_t pointer);
// Resolved once the datagram has been handed to the system.
LertaPromise *lerta_udp_send(int64_t pointer, const LertaString *bytes, const LertaString *host,
                             int64_t port);

// Output (io.c), by file descriptor: 1 for stdout or 2 for stderr, the only ones that std:io gives.
// Its writes go through a buffer, written out on the event loop (output.c; see
// docs/internals/platforms.md#output).
LertaPromise *lerta_stream_write(int64_t fd, const LertaString *bytes);
LertaPromise *lerta_stream_flush(int64_t fd);
bool lerta_stream_is_terminal(int64_t fd);
void lerta_print_stdout(const LertaString *text);
void lerta_print_stderr(const LertaString *text);
// print_trace(error), of the error's data and itab, which the compiler passes as one interface
// value (lerta.c).
void lerta_print_trace(void *data, void *const *itab);
// Stdin (stdin.c): up to 64 KiB of what it has, read on a thread of its own, or NULL at its end.
LertaPromise *lerta_stdin_read(void);

// The exception being thrown (see docs/internals/execution.md#exceptions); its data is null while
// there is none. The first entry of an Error's itab gives its message.
typedef struct {
  void *data;
  void *const *itab;
} LertaException;
// Hidden, so that the generated code, whose declaration says so too, reads it directly, rather than
// through the table of addresses that a symbol another library might define needs, which costs a
// register to hold its address across calls.
extern __attribute__((visibility("hidden"))) LertaException lerta_exception;

// The trace of the pending exception (see docs/internals/execution.md#exception-traces), printed if
// it is uncaught: the sites where it was thrown, and of the calls it has gone through, innermost
// first, which the compiler emits as constants. `start` starts a new trace, for a new throw; `push`
// adds to the trace, or starts one if the trace is of another exception, so that a caught exception
// thrown again goes on with its own. A saved trace is a copy, for while the exception is set
// aside: `load` copies it back, and `restore` does and frees it.
typedef struct {
  const LertaString *function;
  const LertaString *file;
  int32_t line;
  int32_t column;
} LertaTraceSite;
void lerta_trace_push(const LertaTraceSite *site);
void lerta_trace_start(const LertaTraceSite *site);
typedef struct LertaTrace LertaTrace;
LertaTrace *lerta_trace_save(void);
void lerta_trace_restore(LertaTrace *saved);
void lerta_trace_free(LertaTrace *saved);

void *lerta_frame_alloc(int64_t size);
void lerta_frame_free(void *frame);

// The length of the queue of objects to drop, before the fields of an unfinished object are
// released, for lerta_free_unfinished.
int64_t lerta_drop_mark(void);
// Frees an object whose construction threw, once the caller has released its fields, dropping
// first what their release queued after `mark`; its deinit does not run. If anything still holds
// the object, which init let escape, the program panics with the exception. `weak_slot` is the
// slot of the object's weak box, or NULL for a struct.
void lerta_free_unfinished(void *object, void **weak_slot, int64_t mark);

// The kinds of the runtime's errors, by their types, in the order std:builtins declares them.
typedef enum {
  LERTA_INDEX_ERROR,
  LERTA_ARITHMETIC_ERROR,
  LERTA_NIL_ERROR,
  LERTA_CAST_ERROR,
  LERTA_ITER_ERROR,
  LERTA_WEAK_ERROR,
  LERTA_IO_ERROR,
  LERTA_VALUE_ERROR,
  LERTA_INIT_ERROR,
  LERTA_CANCELLED_ERROR,
  LERTA_ASSERTION_ERROR
} LertaErrorKind;

// Throws an error of the kind with the message, borrowed (see
// docs/internals/execution.md#exceptions): the caller returns at once.
void lerta_raise(LertaErrorKind kind, const LertaString *message);
void lerta_register_raise(void (*raise)(int32_t kind, const LertaString *message));

// `panic` of std:builtins.
_Noreturn void lerta_panic_string(const LertaString *message);

// After a call of a class's or struct's own equals, compare or hash, which may not throw: they run
// where `==`, `<` and map keys need them, which no code could catch an exception from.
void lerta_check_comparison(void);

#endif
