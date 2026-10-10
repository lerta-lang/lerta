#ifndef LERTA_H
#define LERTA_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

// Objects whose reference count is this value are immortal (static literals)
// and exempt from count operations.
#define LERTA_IMMORTAL INT64_MIN

// Every heap object starts with this header.
typedef struct {
  int64_t ref_count;
  // Releases what the object owns before it is freed; NULL if it owns nothing.
  void (*drop)(void *object);
} LertaHeader;

typedef struct {
  LertaHeader header;
  int64_t length;  // in bytes
  uint8_t bytes[];  // UTF-8, not NUL-terminated
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

// How a map treats its keys: Ints, and Bytes and Bools, are compared as they are, Strings by their
// bytes, objects by identity, and values, such as structs and arrays, by the map's `hash` and
// `equals`; all but Ints, Bytes and Bools are retained while the map holds them. The keys of byte
// keys are byte items (see LertaItemKind).
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

// Keys are 8 bytes each, plain items or references, and values are items of the map's kind.
// Entries are kept in insertion order, and `slots` is an open-addressing index into them.
typedef struct {
  LertaHeader header;
  int64_t length;  // live entries
  int64_t entry_count;
  int64_t entry_capacity;
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

// An Iter. Its has_next and next take the Iter itself, whose state follows these fields; next
// returns the item, owned, in the representation of its type, so the compiler declares its type.
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
// With LERTA_DEBUG, live objects are counted; returns false after reporting a leak to stderr.
bool lerta_check_leaks(void);
// Runs a class's deinit on its object, whose count has reached zero, from its drop function. The
// object counts as referenced once while deinit runs, so that passing it on and releasing it again
// does not drop it twice; deinit must not keep it, which would bring a dropped object back.
void lerta_run_deinit(void *object, void (*deinit)(void *object));
// A `weak!` field holds a box of its object instead of the object, shared by every such field of
// it. The object and its box point at each other without counting: `slot` is where the object
// keeps its box. Whichever goes first clears the other's pointer, so that the object is freed as
// soon as nothing else holds it.
void *lerta_weak_box(void *object, void **slot);
// The object of the box, borrowed, or NULL if it is gone.
void *lerta_weak_object(void *box);
// Called first by the drop function of a class's object, with the place of its box. A box made
// for the object after that, as by its deinit, holds no object.
void lerta_weak_detach(void **slot);

// Strings (string.c). Also the constructors of Binary values, which share the representation:
// `lerta_string_new` leaves the bytes for the caller to fill.
LertaString *lerta_string_new(int64_t length);
LertaString *lerta_string_from_bytes(const void *bytes, int64_t length);
LertaString *lerta_int_to_string(int64_t n);
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
// The same object, whose bytes the caller has checked to be valid UTF-8, as a String (retained).
LertaString *lerta_binary_as_string(LertaString *binary);

// Items (array.c): the size of an item of the kind, and the counting of the reference it holds.
int64_t lerta_item_size(LertaItemKind kind);
void lerta_retain_item(LertaItemKind kind, const void *item);
void lerta_release_item(LertaItemKind kind, const void *item);
// The item at the index of an array of any kind but interface values, as 8 bytes: a byte item is
// zero-extended.
int64_t lerta_word_item(const LertaArray *array, int64_t index);

// Arrays (array.c). Items are passed through pointers to them. Items in are borrowed; get and pop
// write the item owned. An index out of range throws.
LertaArray *lerta_array_create(LertaItemKind item_kind);
int64_t lerta_array_length(const LertaArray *array);
void lerta_array_read(const LertaArray *array, int64_t index, void *item);
void lerta_array_write(LertaArray *array, int64_t index, const void *item);
void lerta_array_append(LertaArray *array, const void *item);
void lerta_array_take_last(LertaArray *array, void *item);
// Appends an item of any kind but interface values, given as 8 bytes (see lerta_word_item).
void lerta_array_append_word(LertaArray *array, int64_t word);
// Whether two arrays hold equal items in the same order, and a hash of the items in order.
bool lerta_array_equals(const LertaArray *a, const LertaArray *b, LertaEquals equals);
uint64_t lerta_array_hash(const LertaArray *array, LertaHash hash);
LertaString *lerta_string_join(const LertaArray *strings, const LertaString *separator);
// The string as a NUL-terminated C string, which the caller frees; NULL if it holds a NUL byte,
// which C would take as its end.
char *lerta_c_string(const LertaString *s);

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

// Iters (iter.c). Starting a traversal of an Iter that has started one throws, and so does next
// past the end.
void lerta_iter_start(LertaIter *iter);
void lerta_raise_iter_ended(void);

// Process (process.c). The arguments exclude the program name; they are Binary values, as nothing
// makes them UTF-8.
void lerta_set_arguments(int argc, char **argv);
LertaArray *lerta_argv(void);
// Flushes stdout and ends the program; leaks are not checked, as for a throw.
_Noreturn void lerta_exit(int64_t code);
int64_t lerta_run(const LertaString *command, const LertaArray *args);

// Files (file.c). A failure throws.
LertaString *lerta_read_file(const LertaString *path);
void lerta_write_file(const LertaString *path, const LertaString *data);
bool lerta_is_file(const LertaString *path);
LertaString *lerta_real_path(const LertaString *path);
LertaString *lerta_make_temp_dir(void);
void lerta_remove_tree(const LertaString *path);
// Reads a file to its end through `read`, which returns how many bytes it put in `buffer`, 0 at
// the end, or -1 on failure; returns NULL on failure.
LertaString *lerta_read_chunks(int64_t (*read)(void *file, uint8_t *buffer, int64_t size),
                               void *file);

// What differs between systems: platform_posix.c and platform_windows.c, each of which compiles to
// nothing on the other. Paths and arguments are NUL-terminated UTF-8, and a false or NULL result
// is a failure.
// Stack overflow: reported as a panic. Called first thing in main.
void lerta_stack_init(void);
// Gives main's arguments as the system's bytes, which are UTF-8 on Windows: POSIX leaves them as
// they are, and Windows replaces them with ones read from its UTF-16 command line.
void lerta_os_arguments(int *argc, char ***argv);
// Writes all the bytes to stdout (1) or stderr (2); on POSIX, to any file descriptor.
bool lerta_os_write(int fd, const uint8_t *bytes, int64_t length);
bool lerta_os_is_terminal(int fd);
// Ends the program at once, without flushing stdout.
_Noreturn void lerta_os_exit(int code);
// Ends the program as a failure that is not an exit code, as C's abort does.
_Noreturn void lerta_os_abort(void);
LertaString *lerta_os_read_file(const char *path);
bool lerta_os_write_file(const char *path, const uint8_t *bytes, int64_t length);
bool lerta_os_is_file(const char *path);
// The absolute path with no links, which the caller frees.
char *lerta_os_real_path(const char *path);
// A new, empty directory in the system's directory for temporary files, whose path the caller
// frees.
char *lerta_os_make_temp_dir(void);
// Removes a file, or a directory with everything in it; a symbolic link is removed, not followed.
bool lerta_os_remove_tree(const char *path);
// Runs the command `args[0]`, found as the system finds commands, with `args`, which end with
// NULL, and waits for it to end.
bool lerta_os_run(char **args, int64_t *exit_code);

// Output (io.c). A Writer is a file descriptor: 1 for stdout or 2 for stderr. For how stdout is
// buffered, which init decides, see docs/internals.md#output.
void lerta_stdout_init(void);
void lerta_writer_write(int64_t fd, const LertaString *bytes);
void lerta_writer_flush(int64_t fd);

// The exception being thrown, an Error interface value, from its throw until a catch takes it; its
// data is null while there is none. The generated code checks it after each call (see
// docs/internals.md#exceptions). The first entry of an Error's itab gives its message.
typedef struct {
  void *data;
  void *const *itab;
} LertaException;
extern LertaException lerta_exception;

// The message of the pending exception, owned, which the first entry of an Error's itab gives.
LertaString *lerta_exception_message(void);

// Frees an object whose construction threw, once the caller has released its fields; its deinit
// does not run.
void lerta_free_unfinished(void *object);

// The kinds of the runtime's errors, by their types in std:builtins, in the order of
// RUNTIME_ERRORS in compiler/checker/interface_values.lerta.
typedef enum {
  LERTA_INDEX_ERROR,
  LERTA_ARITHMETIC_ERROR,
  LERTA_NIL_ERROR,
  LERTA_CAST_ERROR,
  LERTA_ITER_ERROR,
  LERTA_WEAK_ERROR,
  LERTA_IO_ERROR,
  LERTA_VALUE_ERROR
} LertaErrorKind;

// Throws an error of the kind with the message, borrowed: sets the pending exception, which the
// generated code checks after the call, and the caller returns at once. The program registers
// the function that makes the error (see lerta_register_raise); without one, as in a program
// that is std:builtins or one of the modules it imports, which have no error types to make, it
// stops the program as lerta_throw does.
void lerta_raise(LertaErrorKind kind, const LertaString *message);
void lerta_register_raise(void (*raise)(int32_t kind, const LertaString *message));

// A throw of a String prints the message to stderr and exits.
_Noreturn void lerta_throw(const LertaString *message);
// Returns false if any output to stdout has failed.
bool lerta_stdout_flush(void);
void lerta_stderr_write(const uint8_t *bytes, int64_t length);

// Runtime-internal helpers.
enum { LERTA_INT_TEXT_MAX = 20 };  // 19 digits and a sign
// Writes the decimal text of n at the end of buffer and returns where it starts.
int64_t lerta_format_int(int64_t n, uint8_t buffer[LERTA_INT_TEXT_MAX]);
_Noreturn void lerta_panic(const char *message);
_Noreturn void lerta_panic_with(const char *prefix, const LertaString *message);

#endif
