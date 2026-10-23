// Allocates places of one size, more than three slabs hold, frees some of each slab, and allocates
// them again, which runs each free list down to its last place and takes each slab's last places
// never used; then again, on the slabs that the first round emptied. Every place must be apart from
// the others and keep what is written to it.
#include <string.h>
#include <unistd.h>
#include "internal.h"

#define SIZE 32
#define COUNT 7001
static uint8_t *places[COUNT];

static uint8_t fill_of(int index, int round) { return (uint8_t)(index * 7 + round * 3 + 1); }

static void allocate(int index, int round) {
  places[index] = lerta_mem_alloc(SIZE);
  memset(places[index], fill_of(index, round), SIZE);
}

// A place freed in every 7th, then some at the ends of runs, and the last.
static bool is_freed(int index) { return index % 7 == 3 || index % 1000 < 2 || index == COUNT - 1; }

void lerta_main(void) {
  for (int round = 0; round < 2; round++) {
    for (int i = 0; i < COUNT; i++) allocate(i, round);
    for (int i = 0; i < COUNT; i++) {
      if (is_freed(i)) lerta_mem_free(places[i]);
    }
    for (int i = 0; i < COUNT; i++) {
      if (is_freed(i)) allocate(i, round + 2);
    }
    for (int i = 0; i < COUNT; i++) {
      uint8_t fill = fill_of(i, is_freed(i) ? round + 2 : round);
      for (int b = 0; b < SIZE; b++) {
        if (places[i][b] != fill) _exit(1);
      }
      for (int j = 0; j < i; j++) {
        if (places[j] == places[i]) _exit(2);
      }
    }
    for (int i = 0; i < COUNT; i++) lerta_mem_free(places[i]);
  }
}
