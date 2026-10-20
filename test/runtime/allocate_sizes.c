// Places at the edges of the size classes, of slabs and of regions of their own, each filled with
// bytes of its own, which must all be there once all are allocated; then more places of one size
// than the empty slabs that the allocator keeps hold, freed and allocated again. They come from the
// allocator itself, since the debug runtime puts more before an object.
#include <string.h>
#include <unistd.h>
#include "internal.h"
#include "sizes.h"

#define PER_SIZE 200
#define MANY 20000
static uint8_t *places[SIZES][PER_SIZE];
static void *many[MANY];

void lerta_main(void) {
  for (int s = 0; s < SIZES; s++) {
    for (int i = 0; i < PER_SIZE; i++) {
      places[s][i] = lerta_mem_alloc(sizes[s]);
      memset(places[s][i], fill_of(s, i), (size_t)sizes[s]);
    }
  }
  for (int s = 0; s < SIZES; s++) {
    for (int i = 0; i < PER_SIZE; i++) {
      for (int64_t b = 0; b < sizes[s]; b++) {
        if (places[s][i][b] != fill_of(s, i)) _exit(1);
      }
      lerta_mem_free(places[s][i]);
    }
  }
  for (int round = 0; round < 2; round++) {
    for (int i = 0; i < MANY; i++) many[i] = lerta_mem_alloc(32);
    for (int i = 0; i < MANY; i++) lerta_mem_free(many[i]);
  }
}
