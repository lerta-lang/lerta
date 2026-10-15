#ifndef LERTA_H
#define LERTA_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#define LERTA_IMMORTAL INT64_MIN

typedef struct {
  int64_t ref_count;
  void (*drop)(void *object);
} LertaHeader;

typedef struct {
  LertaHeader header;
  int64_t length;  // in bytes
  uint8_t bytes[];  // UTF-8 for a String, not NUL-terminated
} LertaString;

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

// How arrays and maps hold their items. A plain item is 8 bytes, an Int as is; a byte item is one
// byte, a Byte or a Bool; a reference is 8 bytes, its address, and is retained while it is held. An
// interface value is two pointers, its data, a reference, then its itab.
typedef enum {
  LERTA_PLAIN_ITEMS,
  LERTA_REFERENCE_ITEMS,
  LERTA_INTERFACE_ITEMS,
  LERTA_BYTE_ITEMS
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

// How a map treats its keys (see docs/internals.md#maps). The keys of byte keys are byte items (see
// LertaItemKind).
typedef enum {
  LERTA_INT_KEYS,
  LERTA_STRING_KEYS,
  LERTA_OBJECT_KEYS,
  LERTA_VALUE_KEYS,
  LERTA_BYTE_KEYS
} LertaKeyKind;

// The hash and the equality of two items of a type that compares by its contents.
typedef uint64_t (*LertaHash)(int64_t item);
typedef bool (*LertaEquals)(int64_t a, int64_t b);

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
  void (*drop)(void *object);
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

// Memory (memory.c). Release frees an object when its count reaches zero. Both accept NULL,
// which is how nil is represented.
void *lerta_alloc(int64_t size, void (*drop)(void *object));
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
// The bits of the double that a float literal's text, such as `1.5e3`, rounds to, which the
// compiler writes into the IR and String.parse_float reads back; -1, the bits of a NaN, which no
// finite double has, if it is too large to be finite.
int64_t lerta_float_literal_bits(const LertaString *text);
double lerta_float_from_bits(int64_t bits);
// A Float's text: the fewest digits that read back as it, positional from 1e-4 up to 1e16, with
// `.0` for a whole number, and scientific beyond (`1e+16`).
LertaString *lerta_float_to_string(double value);
// Truncated toward zero; throws an ArithmeticError unless the result fits in an Int.
int64_t lerta_float_to_int(double value);
double lerta_int_to_float(int64_t n);
// Takes `count` borrowed `LertaString *` arguments and returns their concatenation.
LertaString *lerta_string_concat(int64_t count, ...);
bool lerta_string_equals(const LertaString *a, const LertaString *b);
uint64_t lerta_string_hash(const LertaString *s);
// The place of `text` among an enum's `count` member texts, or -1 if none has it (`E.parse`).
int64_t lerta_enum_parse(const LertaString *const *texts, int64_t count, const LertaString *text);

// Binary (binary.c): the same representation as String, without the UTF-8 guarantee. An index or
// a slice out of range throws.
int64_t lerta_binary_length(const LertaString *binary);
uint8_t lerta_binary_get(const LertaString *binary, int64_t index);
int64_t lerta_byte_to_int(uint8_t byte);
uint8_t lerta_int_to_byte(int64_t n);
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

// Maps (map.c). Keys and values in are borrowed; values are passed through pointers to them. get
// returns whether the key is there, and writes its value owned (zeros otherwise); keys returns
// them in insertion order. `hash` and `equals` are NULL but for LERTA_VALUE_KEYS.
LertaMap *lerta_map_create(LertaKeyKind key_kind, LertaItemKind value_kind, LertaHash hash,
                           LertaEquals equals);
int64_t lerta_map_length(const LertaMap *map);
bool lerta_map_read(const LertaMap *map, int64_t key, void *value);
void lerta_map_write(LertaMap *map, int64_t key, const void *value);
void lerta_map_remove(LertaMap *map, int64_t key);
LertaArray *lerta_map_keys(const LertaMap *map);

// next writes the key and the value, owned, and moves on.
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
// The slot of a settled promise; if it holds an exception, throws it.
void *lerta_promise_result(LertaPromise *promise);
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
// Flushes stdout and ends the program; leaks are not checked, as for a throw. A code out of 0 to
// 255 throws a ValueError instead, and the call returns.
void lerta_exit(int64_t code);
// A promise of the program's exit code, settled once it ends; with `output`, an array of bytes,
// its standard output is appended to it first. It is rejected if the output cannot be read, and a
// program that cannot start throws at once.
LertaPromise *lerta_run(const LertaString *command, const LertaArray *args, LertaArray *output);
// The system's name: linux, macos or windows.
LertaString *lerta_platform(void);
// The number of CPUs that are online, at least 1.
int64_t lerta_cpu_count(void);
// The value of an environment variable, as a Binary, or NULL if it is not set.
LertaString *lerta_env(const LertaString *name);

// Files (file.c). A failure throws.
LertaString *lerta_read_file(const LertaString *path);
void lerta_write_file(const LertaString *path, const LertaString *data);
bool lerta_is_file(const LertaString *path);
bool lerta_is_dir(const LertaString *path);
// The names of the entries, checked to be UTF-8, in the order of their bytes.
LertaArray *lerta_list_dir(const LertaString *path);
LertaString *lerta_real_path(const LertaString *path);
LertaString *lerta_make_temp_dir(void);
void lerta_remove_tree(const LertaString *path);
void lerta_make_dir(const LertaString *path);
void lerta_rename(const LertaString *from, const LertaString *to);

// Output (io.c). A Writer is a file descriptor: 1 for stdout or 2 for stderr. For how stdout is
// buffered, which init decides, see docs/internals.md#output.
void lerta_writer_write(int64_t fd, const LertaString *bytes);
void lerta_writer_flush(int64_t fd);

// The exception being thrown (see docs/internals.md#exceptions); its data is null while there is
// none. The first entry of an Error's itab gives its message.
typedef struct {
  void *data;
  void *const *itab;
} LertaException;
extern LertaException lerta_exception;

void *lerta_frame_alloc(int64_t size);
void lerta_frame_free(void *frame);

// Frees an object whose construction threw, once the caller has released its fields; its deinit
// does not run.
void lerta_free_unfinished(void *object);

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
  LERTA_INIT_ERROR
} LertaErrorKind;

// Throws an error of the kind with the message, borrowed (see docs/internals.md#exceptions): the
// caller returns at once.
void lerta_raise(LertaErrorKind kind, const LertaString *message);
void lerta_register_raise(void (*raise)(int32_t kind, const LertaString *message));

// `panic` of std:builtins.
_Noreturn void lerta_panic_string(const LertaString *message);

#endif
