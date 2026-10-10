#include "lerta.h"

LERTA_STATIC_STRING(traversed_twice, "an Iter can be traversed only once");
LERTA_STATIC_STRING(ended, "next past the end of an Iter");

void lerta_iter_start(LertaIter *iter) {
  if (iter->started) lerta_raise(LERTA_ITER_ERROR, (const LertaString *)&traversed_twice);
  iter->started = true;
}

void lerta_raise_iter_ended(void) { lerta_raise(LERTA_ITER_ERROR, (const LertaString *)&ended); }
