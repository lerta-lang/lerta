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

// Items are 8 bytes each: an Int as is, a Bool zero-extended and a reference as its address.
typedef struct {
  LertaHeader header;
  int64_t length;
  int64_t capacity;
  int64_t *items;
  // Whether the items are references, which the array retains while it holds them.
  bool owns_references;
} LertaArray;

typedef struct {
  int64_t key;
  int64_t value;
  uint64_t hash;
  bool live;
} LertaMapEntry;

// How a map treats its keys: Ints are compared as they are, Strings by their bytes and objects by
// identity; Strings and objects are retained while the map holds them.
typedef enum { LERTA_INT_KEYS, LERTA_STRING_KEYS, LERTA_OBJECT_KEYS } LertaKeyKind;

// Keys and values are 8 bytes each, as array items are. Entries are kept in insertion order, and
// `slots` is an open-addressing index into them.
typedef struct {
  LertaHeader header;
  int64_t length;  // live entries
  int64_t entry_count;
  int64_t entry_capacity;
  LertaMapEntry *entries;
  int64_t slot_count;  // a power of two
  int64_t *slots;
  LertaKeyKind key_kind;
  bool owns_values;
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

// Strings (string.c). Also the constructors of Binary values, which share the representation:
// `lerta_string_new` leaves the bytes for the caller to fill.
LertaString *lerta_string_new(int64_t length);
LertaString *lerta_string_from_bytes(const void *bytes, int64_t length);
LertaString *lerta_int_to_string(int64_t n);
// Takes `count` borrowed `LertaString *` arguments and returns their concatenation.
LertaString *lerta_string_concat(int64_t count, ...);
bool lerta_string_equals(const LertaString *a, const LertaString *b);

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

// Arrays (array.c). Items in and out are borrowed, except that get and pop return owned
// references. An index out of range throws.
LertaArray *lerta_array_new(bool owns_references);
int64_t lerta_array_length(const LertaArray *array);
int64_t lerta_array_get(const LertaArray *array, int64_t index);
void lerta_array_set(LertaArray *array, int64_t index, int64_t item);
void lerta_array_push(LertaArray *array, int64_t item);
int64_t lerta_array_pop(LertaArray *array);
LertaString *lerta_string_join(const LertaArray *strings, const LertaString *separator);
// The string as a NUL-terminated C string, which the caller frees; NULL if it holds a NUL byte,
// which C would take as its end.
char *lerta_c_string(const LertaString *s);

// Maps (map.c). Keys and values in are borrowed. get returns whether the key is there, and its
// value owned through `value` (0 otherwise); keys returns them in insertion order.
LertaMap *lerta_map_new(LertaKeyKind key_kind, bool owns_values);
int64_t lerta_map_length(const LertaMap *map);
bool lerta_map_get(const LertaMap *map, int64_t key, int64_t *value);
void lerta_map_set(LertaMap *map, int64_t key, int64_t value);
void lerta_map_remove(LertaMap *map, int64_t key);
LertaArray *lerta_map_keys(const LertaMap *map);

// Iters (iter.c). Starting a traversal of an Iter that has started one throws, and so does next
// past the end.
void lerta_iter_start(LertaIter *iter);
_Noreturn void lerta_throw_iter_ended(void);

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
// Runs the command `args[0]`, found as the system finds commands, with `args`, which end with
// NULL, and waits for it to end.
bool lerta_os_run(char **args, int64_t *exit_code);

// Output (io.c). A Writer is a file descriptor: 1 for stdout or 2 for stderr. For how stdout is
// buffered, which init decides, see docs/internals.md#output.
void lerta_stdout_init(void);
void lerta_writer_write(int64_t fd, const LertaString *bytes);
void lerta_writer_flush(int64_t fd);

// stage0 has no catch: a throw prints the message to stderr and exits.
_Noreturn void lerta_throw(const LertaString *message);
_Noreturn void lerta_throw_index_out_of_range(void);
// Returns false if any output to stdout has failed.
bool lerta_stdout_flush(void);
void lerta_stderr_write(const uint8_t *bytes, int64_t length);

// Runtime-internal helpers.
enum { LERTA_INT_TEXT_MAX = 20 };  // 19 digits and a sign
// Writes the decimal text of n at the end of buffer and returns where it starts.
int64_t lerta_format_int(int64_t n, uint8_t buffer[LERTA_INT_TEXT_MAX]);
_Noreturn void lerta_panic(const char *message);

#endif
