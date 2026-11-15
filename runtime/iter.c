#include "internal.h"

LERTA_STATIC_STRING(traversed_twice, "an Iter can be traversed only once");
LERTA_STATIC_STRING(ended, "next past the end of an Iter");
LERTA_STATIC_STRING(running, "an Iter cannot be read while its function runs");

void lerta_start_traversal(bool *started) {
  if (*started) lerta_raise(LERTA_ITER_ERROR, LERTA_STR(traversed_twice));
  *started = true;
}

void lerta_iter_start(LertaIter *iter) { lerta_start_traversal(&iter->started); }

void lerta_raise_iter_ended(void) { lerta_raise(LERTA_ITER_ERROR, LERTA_STR(ended)); }

void lerta_raise_iter_running(void) {
  lerta_raise(LERTA_ITER_ERROR, LERTA_STR(running));
}
