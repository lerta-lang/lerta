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

void lerta_print(const LertaString *s);
// Returns false if any output to stdout has failed.
bool lerta_stdout_flush(void);

#endif
