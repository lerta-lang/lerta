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

// Memory (memory.c). Release frees an object when its count reaches zero. Both accept NULL,
// which is how nil is represented.
void *lerta_alloc(int64_t size, void (*drop)(void *object));
void lerta_retain(void *object);
void lerta_release(void *object);
// With LERTA_DEBUG, live objects are counted; returns false after reporting a leak to stderr.
bool lerta_check_leaks(void);

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

// Output (io.c)
void lerta_print_string(const LertaString *s);
void lerta_print_int(int64_t n);
void lerta_print_bool(bool b);
void lerta_print_byte(uint8_t b);

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
