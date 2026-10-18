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

// How arrays and maps hold their items. A plain item is 8 bytes, an Int as is; a reference is 8
// bytes, its address, and is retained while it is held. An interface value is two pointers, its
// data, a reference, then its itab. LERTA_NO_ITEMS take no bytes, as the values of a set, a map
// without values, do. An integer narrower than 8 bytes, a Bool or a Float32's bits, is
// LERTA_INTEGER_ITEMS with its size in bytes in LERTA_ITEM_BYTES, and LERTA_SIGNED_ITEMS if it is
// signed, and takes that size.
typedef enum {
  LERTA_PLAIN_ITEMS,
  LERTA_REFERENCE_ITEMS,
  LERTA_INTERFACE_ITEMS,
  // 3 was the kind of bytes, before the integer items; 4 stays, as the seed's IR passes it.
  LERTA_NO_ITEMS = 4,
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

// How a map treats its keys (see docs/internals.md#maps). Int keys are words, an Int, a UInt64, a
// Float or an enum, compared as they are; so are integer keys narrower than a word,
// LERTA_INTEGER_KEYS with their size and sign, as in LertaItemKind.
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
// The text of an item, owned, as `to_string` of an array gives each (see lerta_array_text).
typedef LertaString *(*LertaItemText)(int64_t item);

// See docs/internals.md#maps.
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

// An Int? as C functions take and return it: whether there is a value, and the value.
typedef struct {
  bool present;
  int64_t value;
} LertaOptionalInt;

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
LertaString *lerta_int_to_string(int64_t n);
LertaString *lerta_uint64_to_string(uint64_t n);
// The bits of the double that a float literal's text, such as `1.5e3`, rounds to, which the
// compiler writes into the IR and String.parse_float reads back; -1, the bits of a NaN, which no
// finite double has, if it is too large to be finite.
int64_t lerta_float_literal_bits(const LertaString *text);
// Likewise for a float, given as the bits of the same value as a double, as the IR writes a float
// constant.
int64_t lerta_float32_literal_bits(const LertaString *text);
double lerta_float_from_bits(int64_t bits);
// A Float's text: the fewest digits that read back as it, positional from 1e-4 up to 1e16, with
// `.0` for a whole number, and scientific beyond (`1e+16`). A Float32's likewise, of the digits
// that read back as it as a float.
LertaString *lerta_float_to_string(double value);
LertaString *lerta_float32_to_string(float value);
// Whether the value is finite as a float, which only then is it converted to.
bool lerta_float_fits_float32(double value);
float lerta_float_to_float32(double value);
double lerta_float32_to_float(float value);

// std:math's sqrt, pow and remainder, which throw where libm's result would not be finite.
double lerta_math_sqrt(double x);
double lerta_math_pow(double x, double y);
double lerta_math_remainder(double x, double y);

// Whether the value truncated toward zero fits in an Int, which only then is it converted to.
bool lerta_float_fits_int(double value);
int64_t lerta_float_to_int(double value);
// Takes `count` borrowed `LertaString *` arguments and returns their concatenation.
LertaString *lerta_string_concat(int64_t count, ...);
// `*slot += part`, for a String or a Binary: `old` is what the slot held when `+=` began, owned,
// and taken; `part` is borrowed. When the slot still holds `old` and nothing else does, the bytes
// are appended in place, so that a loop of `+=` is O(n).
void lerta_string_append(LertaString **slot, LertaString *old, const LertaString *part);
bool lerta_string_equals(const LertaString *a, const LertaString *b);
// -1, 0 or 1 as `a` goes before, with or after `b` in the order of their bytes: `String.compare` and
// `<` and the like of Strings.
int64_t lerta_string_compare(const LertaString *a, const LertaString *b);
uint64_t lerta_string_hash(const LertaString *s);
// The place of `text` among an enum's `count` member texts, or -1 if none has it (`E.parse`).
int64_t lerta_enum_parse(const LertaString *const *texts, int64_t count, const LertaString *text);

// Binary (binary.c): the same representation as String, without the UTF-8 guarantee. An index or
// a slice out of range throws.
int64_t lerta_binary_length(const LertaString *binary);
uint8_t lerta_binary_get(const LertaString *binary, int64_t index);
LertaString *lerta_binary_slice(const LertaString *binary, int64_t start, int64_t end);
LertaString *lerta_binary_from_bytes(const LertaArray *bytes);
// The place of the first occurrence of `part`, which is not empty, at `from` (not negative) or
// after, or -1 if there is none.
int64_t lerta_binary_find(const LertaString *binary, const LertaString *part, int64_t from);
// UTF-8, which builtins reads through these, so that its rules are written once. The number of
// bytes of the sequence that `lead` starts, or 0 if it cannot start one.
int64_t lerta_utf8_sequence_length(uint8_t lead);
bool lerta_is_utf8_continuation(uint8_t byte);
bool lerta_is_utf8(const LertaString *binary);
// The same object, whose bytes the caller has checked to be valid UTF-8, as a String (retained).
LertaString *lerta_binary_as_string(LertaString *binary);

// Arrays (array.c). Items are passed through pointers to them. Items in are borrowed; pop writes
// the item owned.
LertaArray *lerta_array_create(LertaItemKind item_kind);
int64_t lerta_array_length(const LertaArray *array);
// For the runtime's own code: the generated code pushes in place (below).
void lerta_array_append(LertaArray *array, const void *item);
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
LertaString *lerta_string_join(const LertaArray *strings, const LertaString *separator);
LertaString *lerta_array_text(const LertaArray *array, LertaItemText text_of);
LertaString *lerta_string_quoted(const LertaString *s);
LertaString *lerta_bool_text(bool value);

// Maps (map.c). Keys and values in are borrowed; values are passed through pointers to them. get
// returns whether the key is there, and writes its value owned (zeros otherwise); keys returns
// them in insertion order. `hash` and `equals` are NULL but for LERTA_VALUE_KEYS.
LertaMap *lerta_map_create(LertaKeyKind key_kind, LertaItemKind value_kind, LertaHash hash,
                           LertaEquals equals);
int64_t lerta_map_length(const LertaMap *map);
bool lerta_map_read(const LertaMap *map, int64_t key, void *value);
void lerta_map_write(LertaMap *map, int64_t key, const void *value);
void lerta_map_remove(LertaMap *map, int64_t key);

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
// Whether the coroutine is to wait for the promise, which is pending; it is resumed once the
// promise is settled.
bool lerta_promise_wait(LertaPromise *promise, void *coroutine);
// Where the value goes, before lerta_promise_resolve; where it is read once the promise is settled.
void *lerta_promise_slot(LertaPromise *promise);
void lerta_promise_resolve(LertaPromise *promise);
void lerta_promise_reject(LertaPromise *promise);
// As lerta_promise_wait and lerta_promise_result, for the body of a function that awaits, whose own
// promise is `own`: they record what it waits for, which cancel follows, and the result throws a
// CancelledError instead if the body's promise has been cancelled meanwhile.
bool lerta_promise_wait_in(LertaPromise *promise, void *coroutine, LertaPromise *own);
void *lerta_promise_result_in(LertaPromise *promise, LertaPromise *own);
// Cancels the work that the promise waits for (see async.c); nothing if it is settled.
void lerta_promise_cancel(LertaPromise *promise);
// The slot of a settled promise; if it holds an exception, throws it.
void *lerta_promise_result(LertaPromise *promise);
// A promise without a value that lerta_promise_fire resolves, unless it is settled already.
LertaPromise *lerta_promise_pending(void);
void lerta_promise_fire(LertaPromise *promise);
// A promise resolved once the seconds have passed; a negative time throws.
LertaPromise *lerta_sleep(double seconds);
// Seconds since the Unix epoch, 1970-01-01T00:00:00Z.
double lerta_unix_time(void);
// Runs the loop; `resume` resumes a coroutine, which only the generated code can do.
void lerta_loop_run(void (*resume)(void *coroutine));
// After the loop, the end of the program's top-level code, a coroutine that awaits: an error if it
// still waits, and its exception, if it threw, as the pending one.
void lerta_finish_top_level(LertaPromise *promise);

// Process (process.c). The arguments exclude the program name; they are Binary values, as nothing
// makes them UTF-8.
LertaArray *lerta_argv(void);
// Flushes stdout and ends the program; only the objects that nothing in use holds are checked for
// leaks, and a leak ends it with LERTA_LEAK_EXIT_CODE in place of `code`. A code out of 0 to 255
// throws a ValueError instead, and the call returns.
void lerta_exit(int64_t code);
// A promise of the program's exit code, or minus the signal that ended it, settled once it ends.
// It reads `input` as its standard input, if given; its standard output and error are appended to
// `output` and `errors`, arrays of bytes, if given; it runs in `cwd`, if given, with the variables
// of this program but those that `unset` names, and those that `set` names with `values`. It is
// rejected if an output cannot be read, and a program that cannot start throws at once. A cancel
// stops the program, killing it after `kill_after` seconds, and rejects the promise once it ends.
LertaPromise *lerta_run(const LertaString *command, const LertaArray *args,
                        const LertaString *input, LertaArray *output, LertaArray *errors,
                        const LertaString *cwd, const LertaArray *set, const LertaArray *values,
                        const LertaArray *unset, double kill_after);
// Whether two names of environment variables name the same variable.
bool lerta_same_env_name(const LertaString *a, const LertaString *b);
// The system's name: linux, macos or windows.
LertaString *lerta_platform(void);
// The number of CPUs that are online, at least 1.
int64_t lerta_cpu_count(void);
// The ID of the program's process.
int64_t lerta_process_id(void);
// Whether a process with the ID is running.
bool lerta_is_running(int64_t id);
// The value of an environment variable, as a Binary, or NULL if it is not set.
LertaString *lerta_env(const LertaString *name);

// Files (file.c). A failure throws, or rejects the promise of one that runs on the thread pool.
LertaPromise *lerta_read_file_async(const LertaString *path);
LertaPromise *lerta_write_file_async(const LertaString *path, const LertaString *data);
LertaPromise *lerta_remove_tree_async(const LertaString *path);
LertaPromise *lerta_copy_file_async(const LertaString *from, const LertaString *to);
bool lerta_is_file(const LertaString *path);
bool lerta_is_dir(const LertaString *path);
// Whether the path names something, through symbolic links; if it does, its kind (0 a file, 1 a
// directory, 2 another), its size and the time it was last modified, in nanoseconds since the Unix
// epoch, are appended to the array of Ints, which std:io makes a FileStatus of.
bool lerta_stat_fields(const LertaString *path, LertaArray *fields);
void lerta_make_link(const LertaString *target, const LertaString *path);
// The names of the entries, unchecked and in no order (std:io checks and sorts them).
LertaArray *lerta_list_dir_names(const LertaString *path);
LertaString *lerta_real_path(const LertaString *path);
LertaString *lerta_make_temp_dir(void);
void lerta_make_dir(const LertaString *path);
void lerta_rename(const LertaString *from, const LertaString *to);

// Output (io.c). A Writer is a file descriptor: 1 for stdout or 2 for stderr. Its writes go through
// a buffer, written out on the event loop (output.c; see docs/internals.md#output).
LertaPromise *lerta_stream_write(int64_t fd, const LertaString *bytes);
LertaPromise *lerta_stream_flush(int64_t fd);
// Up to 64 KiB of what stdin has, read on the thread pool, or NULL at its end.
LertaPromise *lerta_stdin_read(void);
void lerta_print_stdout(const LertaString *text);
void lerta_print_stderr(const LertaString *text);

// The exception being thrown (see docs/internals.md#exceptions); its data is null while there is
// none. The first entry of an Error's itab gives its message.
typedef struct {
  void *data;
  void *const *itab;
} LertaException;
extern LertaException lerta_exception;

// The trace of the pending exception (see docs/internals.md#exception-traces), printed if it is
// uncaught: the sites where it was thrown, and of the calls it has gone through, innermost first,
// which the compiler emits as constants. `start` starts a new trace, for a new throw; `push` adds
// to the trace, or starts one if the trace is of another exception, so that a caught exception
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
void lerta_trace_load(const LertaTrace *saved);
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
  LERTA_CANCELLED_ERROR
} LertaErrorKind;

// Throws an error of the kind with the message, borrowed (see docs/internals.md#exceptions): the
// caller returns at once.
void lerta_raise(LertaErrorKind kind, const LertaString *message);
void lerta_register_raise(void (*raise)(int32_t kind, const LertaString *message));

// `panic` of std:builtins.
_Noreturn void lerta_panic_string(const LertaString *message);

// After a call of a class's or struct's own equals, compare or hash, which may not throw: they run
// where `==`, `<` and map keys need them, which no code could catch an exception from.
void lerta_check_comparison(void);

#endif
