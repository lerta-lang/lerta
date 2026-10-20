// Objects of the sizes, which the debug runtime allocates with its prefix before each, each filled
// after its header with bytes of its own, which must all be there once all are allocated.
#include <string.h>
#include <unistd.h>
#include "lerta.h"
#include "sizes.h"

void lerta_main(void) {
  static uint8_t *objects[SIZES][4];
  for (int s = 0; s < SIZES; s++) {
    for (int i = 0; i < 4; i++) {
      objects[s][i] = lerta_new(sizes[s], NULL);
      memset(objects[s][i] + 16, fill_of(s, i), (size_t)sizes[s] - 16);
    }
  }
  for (int s = 0; s < SIZES; s++) {
    for (int i = 0; i < 4; i++) {
      for (int64_t b = 16; b < sizes[s]; b++) {
        if (objects[s][i][b] != fill_of(s, i)) _exit(1);
      }
      lerta_release(objects[s][i]);
    }
  }
}
