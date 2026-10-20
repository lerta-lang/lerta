// Nor after the dropped one's slab has become empty, which stays its class's slab with room.
#include "lerta.h"

void lerta_main(void) {
  void *object = lerta_new(24, NULL);
  lerta_release(object);
  for (int i = 0; i < 100; i++) lerta_new(24, NULL);
  lerta_retain(object);
}
