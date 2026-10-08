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

// An immortal string constant, as the compiler emits for literals. Like any LertaString, its bytes
// are not NUL-terminated.
#define LERTA_STATIC_STRING(name, text)                     \
  static const struct {                                      \
    LertaHeader header;                                      \
    int64_t length;                                          \
    uint8_t bytes[sizeof(text) - 1] __attribute__((nonstring)); \
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
  // String keys are compared by their bytes and retained; other keys are Ints.
  bool string_keys;
  bool owns_values;
} LertaMap;

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

// Strings (string.c)
LertaString *lerta_int_to_string(int64_t n);
// Takes `count` borrowed `LertaString *` arguments and returns their concatenation.
LertaString *lerta_string_concat(int64_t count, ...);
bool lerta_string_equals(const LertaString *a, const LertaString *b);
// Decimal digits with an optional leading `-`. Returns false if there are none, if anything else
// is there, or if the value does not fit in an Int.
bool lerta_string_parse_int(const LertaString *s, int64_t *result);

// Binary (binary.c): the same representation as String, without the UTF-8 guarantee. An index or
// a slice out of range throws.
int64_t lerta_binary_length(const LertaString *binary);
uint8_t lerta_binary_get(const LertaString *binary, int64_t index);
LertaString *lerta_binary_slice(const LertaString *binary, int64_t start, int64_t end);
// The same object as a String if its bytes are valid UTF-8 (retained), or NULL (nil).
LertaString *lerta_binary_decode_utf8(LertaString *binary);

// Arrays (array.c). Items in and out are borrowed, except that get and pop return owned
// references. An index out of range throws.
LertaArray *lerta_array_new(bool owns_references);
int64_t lerta_array_length(const LertaArray *array);
int64_t lerta_array_get(const LertaArray *array, int64_t index);
void lerta_array_set(LertaArray *array, int64_t index, int64_t item);
void lerta_array_push(LertaArray *array, int64_t item);
int64_t lerta_array_pop(LertaArray *array);
LertaString *lerta_string_join(const LertaArray *strings, const LertaString *separator);

// Maps (map.c). Keys and values in are borrowed. get returns whether the key is there, and its
// value owned through `value` (0 otherwise); keys returns them in insertion order.
LertaMap *lerta_map_new(bool string_keys, bool owns_values);
int64_t lerta_map_length(const LertaMap *map);
bool lerta_map_get(const LertaMap *map, int64_t key, int64_t *value);
bool lerta_map_has(const LertaMap *map, int64_t key);
void lerta_map_set(LertaMap *map, int64_t key, int64_t value);
void lerta_map_remove(LertaMap *map, int64_t key);
LertaArray *lerta_map_keys(const LertaMap *map);

// Process (process.c). The arguments exclude the program name.
void lerta_set_arguments(int argc, char **argv);
LertaArray *lerta_argv(void);
// Flushes stdout and ends the program; leaks are not checked, as for a throw.
_Noreturn void lerta_exit(int64_t code);

// Files (file.c). A failure throws.
LertaString *lerta_read_file(const LertaString *path);
void lerta_write_file(const LertaString *path, const LertaString *data);

// Output (io.c)
void lerta_print_string(const LertaString *s);
void lerta_print_int(int64_t n);
void lerta_print_bool(bool b);
void lerta_print_byte(uint8_t b);
// A Writer is a file descriptor: 1 for stdout, which is buffered, or 2 for stderr, which is not.
// Writing to stderr flushes stdout first, so that the two keep their order.
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
bool lerta_is_valid_utf8(const uint8_t *bytes, int64_t length);

#endif
