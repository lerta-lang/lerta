// Places kept while others are dropped: a release build keeps the slabs that the dropped ones leave
// empty for reuse, as many as there are slabs in use, and the next places of the size take them
// again; dropping twice as many as are kept leaves only as many empty as are in use, the slab
// emptied last first; once all are dropped, EMPTY_SLABS_KEPT are kept. A debug build keeps
// EMPTY_SLABS_KEPT throughout.
#include <unistd.h>
#include "internal.h"

#define SIZE 4096
#define COUNT 1000
static void *kept[COUNT];
static void *dropped[2 * COUNT];

static uintptr_t region_of(void *place) {
  return (uintptr_t)place & ~(uintptr_t)(LERTA_REGION_SIZE - 1);
}

static int64_t at_least_kept(int64_t count) {
  return count > EMPTY_SLABS_KEPT ? count : EMPTY_SLABS_KEPT;
}

// Whether as many slabs are empty as the build keeps for those in use.
static bool keeps_as_many(void) {
  int64_t in_use, empty;
  lerta_mem_slab_counts(&in_use, &empty);
#ifdef LERTA_DEBUG
  return empty == EMPTY_SLABS_KEPT;
#else
  return empty == at_least_kept(in_use);
#endif
}

static void drop(int count) {
  for (int i = 0; i < count; i++) dropped[i] = lerta_mem_alloc(SIZE);
  for (int i = 0; i < count; i++) lerta_mem_free(dropped[i]);
}

void lerta_main(void) {
  int64_t in_use, empty;
  for (int i = 0; i < COUNT; i++) kept[i] = lerta_mem_alloc(SIZE);
#ifdef LERTA_DEBUG
  drop(COUNT);
  if (!keeps_as_many()) _exit(1);
#else
  // As many places as are kept, dropped, leave no more slabs empty than are in use: each that they
  // empty is kept.
  for (int i = 0; i < COUNT; i++) dropped[i] = lerta_mem_alloc(SIZE);
  int64_t in_use_before, empty_before;
  lerta_mem_slab_counts(&in_use_before, &empty_before);
  for (int i = 0; i < COUNT; i++) lerta_mem_free(dropped[i]);
  lerta_mem_slab_counts(&in_use, &empty);
  if (empty - empty_before != in_use_before - in_use) _exit(1);
  // The slabs kept empty are taken again.
  empty_before = empty;
  for (int i = 0; i < COUNT; i++) dropped[i] = lerta_mem_alloc(SIZE);
  lerta_mem_slab_counts(&in_use, &empty);
  if (empty >= empty_before) _exit(2);
  for (int i = 0; i < COUNT; i++) lerta_mem_free(dropped[i]);
#endif
#ifdef LERTA_DEBUG
  drop(2 * COUNT);
#else
  for (int i = 0; i < 2 * COUNT; i++) dropped[i] = lerta_mem_alloc(SIZE);
  uintptr_t emptied_last = 0;
  for (int i = 0; i < 2 * COUNT; i++) {
    lerta_mem_slab_counts(&in_use_before, &empty_before);
    lerta_mem_free(dropped[i]);
    lerta_mem_slab_counts(&in_use, &empty);
    if (in_use < in_use_before) emptied_last = region_of(dropped[i]);
  }
#endif
  if (!keeps_as_many()) _exit(3);
#ifndef LERTA_DEBUG
  // The slab emptied last, which is warm, is kept, and a new slab, of another size, is that one. It
  // stays in use, as the last of its class with room, as one of the kept places' does.
  void *other = lerta_mem_alloc(64);
  if (region_of(other) != emptied_last) _exit(5);
  lerta_mem_free(other);
#endif
  for (int i = 0; i < COUNT; i++) lerta_mem_free(kept[i]);
  lerta_mem_slab_counts(&in_use, &empty);
  if (in_use > 2 || empty != EMPTY_SLABS_KEPT) _exit(4);
}
