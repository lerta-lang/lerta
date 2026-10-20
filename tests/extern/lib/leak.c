// The C side of leak.lerta, which test/cli.lerta links with it: an object that is never released.
#include <stdint.h>

void *lerta_new(int64_t size, const void *type);

void leak(void) {
  lerta_new(16, 0);
}
