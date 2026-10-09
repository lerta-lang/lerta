// The C side of leak.lerta, which test/cli.ts links with it: an object that is never released.
#include <stdint.h>

void *lerta_alloc(int64_t size, void (*drop)(void *object));

void leak(void) {
  lerta_alloc(16, 0);
}
