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

void lerta_print_string(const LertaString *s);
void lerta_print_int(int64_t n);
void lerta_print_bool(bool b);

// stage0 has no catch: a throw prints the message to stderr and exits.
_Noreturn void lerta_throw(const LertaString *message);
// Returns false if any output to stdout has failed.
bool lerta_stdout_flush(void);

#endif
