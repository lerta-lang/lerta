// Sizes at the edges of the size classes, of slabs and of regions of their own.
// 16368 and 16369 are the largest size that fits in a slab with the debug runtime's prefix of 16
// bytes before it, and the smallest that does not.
#include <stdint.h>

static const int64_t sizes[] = {
  16, 17, 24, 255, 256, 257, 320, 321, 16368, 16369, 16384, 16385, 100000};
#define SIZES (int)(sizeof sizes / sizeof sizes[0])

static uint8_t fill_of(int s, int i) { return (uint8_t)(s * 31 + i); }
