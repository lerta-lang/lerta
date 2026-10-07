#ifndef LERTA_H
#define LERTA_H

#include <stdbool.h>
#include <stdint.h>

// Objects whose reference count is this value are immortal (static literals)
// and exempt from count operations.
#define LERTA_IMMORTAL INT64_MIN

typedef struct {
  int64_t ref_count;
  int64_t length;  // in bytes
  uint8_t bytes[];  // UTF-8, not NUL-terminated
} LertaString;

// Memory (memory.c). Every heap object starts with its reference count.
// Release frees an object when its count reaches zero; strings own no other objects.
void *lerta_alloc(int64_t size);
void lerta_retain(void *object);
void lerta_release(void *object);
// With LERTA_DEBUG, live objects are counted; returns false after reporting a leak to stderr.
bool lerta_check_leaks(void);

// Strings (string.c)
LertaString *lerta_int_to_string(int64_t n);

// Output (io.c)
void lerta_print_string(const LertaString *s);
void lerta_print_int(int64_t n);
void lerta_print_bool(bool b);

// stage0 has no catch: a throw prints the message to stderr and exits.
_Noreturn void lerta_throw(const LertaString *message);
// Returns false if any output to stdout has failed.
bool lerta_stdout_flush(void);
void lerta_stderr_write(const uint8_t *bytes, int64_t length);

// Runtime-internal helpers.
enum { LERTA_INT_TEXT_MAX = 20 };  // 19 digits and a sign
// Writes the decimal text of n at the end of buffer and returns where it starts.
int64_t lerta_format_int(int64_t n, uint8_t buffer[LERTA_INT_TEXT_MAX]);
_Noreturn void lerta_panic(const char *message);

#endif
