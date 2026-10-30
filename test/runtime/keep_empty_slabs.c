// Places kept while others are dropped: a release build keeps every slab that the dropped ones
// leave empty, and the next places take them again, the slab emptied last first, so that no more
// slabs are mapped than were in use at once, whatever size takes them; it discards those that no
// place takes for long, but for about as many as are in use. A debug build keeps EMPTY_SLABS_KEPT
// throughout, returning the oldest beyond them.
#include <unistd.h>
#include "internal.h"

#define SIZE 4096
#define COUNT 1000
// More places than a slab of their size holds, so that making them takes an empty slab.
#define CHURNED_SIZE 8192
#define CHURNED 8
// Larger than any slab's places.
#define LARGE_SIZE (64 << 10)
static void *kept[COUNT];
static void *dropped[2 * COUNT];

static uintptr_t region_of(void *place) {
  return (uintptr_t)place & ~(uintptr_t)(LERTA_REGION_SIZE - 1);
}

static int64_t mapped(void) {
  int64_t in_use, empty, discarded;
  lerta_mem_slab_counts(&in_use, &empty, &discarded);
  return in_use + empty;
}

static void drop(int count) {
  for (int i = 0; i < count; i++) dropped[i] = lerta_mem_alloc(SIZE);
  for (int i = 0; i < count; i++) lerta_mem_free(dropped[i]);
}

void lerta_main(void) {
  int64_t in_use, empty, discarded;
  for (int i = 0; i < COUNT; i++) kept[i] = lerta_mem_alloc(SIZE);
#ifdef LERTA_DEBUG
  drop(2 * COUNT);
  lerta_mem_slab_counts(&in_use, &empty, &discarded);
  if (empty != EMPTY_SLABS_KEPT) _exit(1);
  for (int i = 0; i < COUNT; i++) lerta_mem_free(kept[i]);
  lerta_mem_slab_counts(&in_use, &empty, &discarded);
  if (in_use > 2 || empty != EMPTY_SLABS_KEPT) _exit(4);
#else
  // Twice as many places as are kept, dropped, leave every slab that they used empty.
  for (int i = 0; i < 2 * COUNT; i++) dropped[i] = lerta_mem_alloc(SIZE);
  int64_t peak = mapped();
  uintptr_t emptied_last = 0;
  for (int i = 0; i < 2 * COUNT; i++) {
    int64_t in_use_before, empty_before;
    lerta_mem_slab_counts(&in_use_before, &empty_before, &discarded);
    lerta_mem_free(dropped[i]);
    if (mapped() != peak) _exit(1);
    lerta_mem_slab_counts(&in_use, &empty, &discarded);
    if (in_use < in_use_before) emptied_last = region_of(dropped[i]);
  }
  // As many places again map no slab. After the slab of the size that still has room, the slab
  // emptied last, which is warm, is taken first.
  for (int i = 0; i < 2 * COUNT; i++) dropped[i] = lerta_mem_alloc(SIZE);
  int first_taken = 0;
  while (first_taken < 2 * COUNT && region_of(dropped[first_taken]) == region_of(dropped[0])) {
    first_taken++;
  }
  if (first_taken == 2 * COUNT || region_of(dropped[first_taken]) != emptied_last) _exit(2);
  for (int i = 0; i < 2 * COUNT; i++) lerta_mem_free(dropped[i]);
  // Made and dropped over and over, as many places discard no slab.
  for (int i = 0; i < 8; i++) drop(2 * COUNT);
  lerta_mem_slab_counts(&in_use, &empty, &discarded);
  if (discarded != 0 || mapped() != peak) _exit(3);
  // A place of a size that nothing else takes, so that its class has no slab, takes a kept one.
  int64_t empty_before = 0;
  lerta_mem_slab_counts(&in_use, &empty_before, &discarded);
  void *other = lerta_mem_alloc(200);
  lerta_mem_slab_counts(&in_use, &empty, &discarded);
  if (empty != empty_before - 1 || mapped() != peak) _exit(4);
  lerta_mem_free(other);
  // A few places of another size, made and dropped over and over, take and keep only the slabs
  // emptied last, which leaves the others untaken for rounds: all of them but about as many as are
  // in use are discarded.
  for (int i = 0; i < 8 * peak; i++) {
    for (int j = 0; j < CHURNED; j++) dropped[j] = lerta_mem_alloc(CHURNED_SIZE);
    for (int j = 0; j < CHURNED; j++) lerta_mem_free(dropped[j]);
  }
  lerta_mem_slab_counts(&in_use, &empty, &discarded);
  if (discarded == 0 || empty - discarded > in_use + 2 || mapped() != peak) _exit(5);
  // Discarded slabs are taken again as any other.
  for (int i = 0; i < 2 * COUNT; i++) dropped[i] = lerta_mem_alloc(SIZE);
  lerta_mem_slab_counts(&in_use, &empty, &discarded);
  if (discarded != 0) _exit(6);
  for (int i = 0; i < 2 * COUNT; i++) lerta_mem_free(dropped[i]);
  // Large places alone, which take no slab, end rounds too, so that the slabs are discarded again.
  for (int i = 0; i < 8 * peak; i++) lerta_mem_free(lerta_mem_alloc(LARGE_SIZE));
  lerta_mem_slab_counts(&in_use, &empty, &discarded);
  if (discarded == 0 || empty - discarded > in_use + 2) _exit(7);
#endif
}
