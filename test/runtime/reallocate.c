// A buffer grown from none through the sizes, which keeps what it held each time; then grown within
// its place, in a slab and in a region of its own, and given a size more than half of it, which
// keep the place, and one far smaller, which does not.
#include <unistd.h>
#include "internal.h"
#include "sizes.h"

static uint8_t fill_at(int64_t b) { return (uint8_t)(b * 7); }

void lerta_main(void) {
  uint8_t *buffer = NULL;
  int64_t filled = 0;
  for (int s = 0; s < SIZES; s++) {
    buffer = lerta_mem_realloc(buffer, sizes[s]);
    for (int64_t b = 0; b < filled; b++) {
      if (buffer[b] != fill_at(b)) _exit(1);
    }
    for (; filled < sizes[s]; filled++) buffer[filled] = fill_at(filled);
  }
  lerta_mem_free(buffer);
  uint8_t *small = lerta_mem_alloc(17);
  if (lerta_mem_realloc(small, 24) != small) _exit(2);
  uint8_t *large = lerta_mem_alloc(20000);
  if (lerta_mem_realloc(large, 60000) != large) _exit(3);
  if (lerta_mem_realloc(large, 40000) != large) _exit(4);
  large[0] = 9;
  uint8_t *shrunk = lerta_mem_realloc(large, 16);
  if (shrunk == large || shrunk[0] != 9) _exit(5);
  lerta_mem_free(small);
  lerta_mem_free(shrunk);
  lerta_mem_free(NULL);
}
