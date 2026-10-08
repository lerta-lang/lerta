#include "lerta.h"

LERTA_STATIC_STRING(traversed_twice, "an Iter can be traversed only once");
LERTA_STATIC_STRING(ended, "next past the end of an Iter");

void lerta_iter_start(LertaIter *iter) {
  if (iter->started) lerta_throw((const LertaString *)&traversed_twice);
  iter->started = true;
}

_Noreturn void lerta_throw_iter_ended(void) { lerta_throw((const LertaString *)&ended); }
