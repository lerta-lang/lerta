// A new object of the same size does not take the dropped one's place, in a slab with room.
#include "lerta.h"

void lerta_main(void) {
  lerta_new(16, NULL);
  void *object = lerta_new(16, NULL);
  lerta_release(object);
  lerta_new(16, NULL);
  lerta_release(object);
}
