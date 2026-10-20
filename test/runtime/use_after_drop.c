// USE, lerta_retain or lerta_release, of an object that is dropped.
#include "lerta.h"

void lerta_main(void) {
  void *object = lerta_new(16, NULL);
  lerta_release(object);
  USE(object);
}
