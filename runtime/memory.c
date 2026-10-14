#include <stdlib.h>

#include "internal.h"

#ifdef LERTA_DEBUG
static int64_t live_objects = 0;
#endif

void *lerta_checked_malloc(size_t size) {
  void *memory = malloc(size);
  if (memory == NULL) lerta_panic("out of memory");
  return memory;
}

void *lerta_checked_realloc(void *memory, size_t size) {
  void *grown = realloc(memory, size);
  if (grown == NULL) lerta_panic("out of memory");
  return grown;
}

void *lerta_checked_calloc(size_t count, size_t size) {
  void *memory = calloc(count, size);
  if (memory == NULL) lerta_panic("out of memory");
  return memory;
}

// The allocator: see docs/internals.md#allocation. A free place keeps an object's count at 0, so
// that a retain or release of what it held stops a debug program, and holds its free-list link
// where an object's drop is.
typedef struct Region Region;
typedef struct Place {
  int64_t count;
  struct Place *next;
} Place;

struct Region {
  // The size of each place, or of the region of a large place.
  int64_t place_size;
  bool is_large;
  int64_t live;
  Place *free_first;
  Place *free_last;
  // The part of a slab not handed out yet.
  uint8_t *fresh;
  // The slabs of the size class with free places.
  Region *previous;
  Region *next;
};

#define PLACES_START (((int64_t)sizeof(Region) + 15) & ~(int64_t)15)
#define SMALLEST_PLACE 16
#define SMALL_LIMIT 256
#define SLAB_LIMIT (16 << 10)
#define SMALL_CLASSES ((SMALL_LIMIT - SMALLEST_PLACE) / 8 + 1)
#define SIZE_CLASSES (SMALL_CLASSES + 4 * 6)
// Empty slabs kept: by a release build for reuse, so that a program that makes and drops the same
// objects over and over does not map and unmap a slab each time; by a debug build, the last ones,
// never reused, so that a use of what they held is still caught.
#define EMPTY_SLABS_KEPT 4

static Region *slabs_with_room[SIZE_CLASSES];
static Region *empty_slabs[EMPTY_SLABS_KEPT];
static int64_t empty_slab_count = 0;
#ifdef LERTA_DEBUG
static int64_t oldest_empty_slab = 0;
#endif

static Region *region_of(const void *memory) {
  return (Region *)((uintptr_t)memory & ~(uintptr_t)(LERTA_REGION_SIZE - 1));
}

static int size_class_of(int64_t size) {
  if (size <= SMALL_LIMIT) {
    return (int)((size < SMALLEST_PLACE ? SMALLEST_PLACE : size) - SMALLEST_PLACE + 7) / 8;
  }
  uint64_t last_byte = (uint64_t)size - 1;
  int power = 63 - __builtin_clzll(last_byte);
  int quarter = (int)(last_byte >> (power - 2)) & 3;
  return SMALL_CLASSES + (power - 8) * 4 + quarter;
}

static int64_t place_size_of(int size_class) {
  if (size_class < SMALL_CLASSES) return SMALLEST_PLACE + 8 * (int64_t)size_class;
  int power = 8 + (size_class - SMALL_CLASSES) / 4;
  int quarter = (size_class - SMALL_CLASSES) % 4;
  return ((int64_t)1 << power) + (quarter + 1) * ((int64_t)1 << (power - 2));
}

static void *map_region(int64_t size) {
  void *region = lerta_os_map_region(size);
  if (region == NULL) lerta_panic("out of memory");
  return region;
}

static void unlink_slab(Region *slab, int size_class) {
  if (slab->previous != NULL) slab->previous->next = slab->next;
  else slabs_with_room[size_class] = slab->next;
  if (slab->next != NULL) slab->next->previous = slab->previous;
  slab->previous = slab->next = NULL;
}

static void link_slab(Region *slab, int size_class) {
  slab->previous = NULL;
  slab->next = slabs_with_room[size_class];
  if (slab->next != NULL) slab->next->previous = slab;
  slabs_with_room[size_class] = slab;
}

static bool has_fresh_room(const Region *slab) {
  return (uint8_t *)slab + LERTA_REGION_SIZE - slab->fresh >= slab->place_size;
}

static bool is_full(const Region *slab) {
  return slab->free_first == NULL && !has_fresh_room(slab);
}

#ifdef LERTA_DEBUG
static Region *take_empty_slab(void) { return NULL; }

static void keep_empty_slab(Region *slab) {
  if (empty_slab_count == EMPTY_SLABS_KEPT) {
    lerta_os_unmap_region(empty_slabs[oldest_empty_slab], LERTA_REGION_SIZE);
    empty_slabs[oldest_empty_slab] = slab;
    oldest_empty_slab = (oldest_empty_slab + 1) % EMPTY_SLABS_KEPT;
  } else {
    empty_slabs[empty_slab_count++] = slab;
  }
}

// The part never used first, then the place freed first, so that a place stays free as long as
// possible.
static bool takes_free_place(const Region *slab) { return !has_fresh_room(slab); }
#else
static Region *take_empty_slab(void) {
  return empty_slab_count > 0 ? empty_slabs[--empty_slab_count] : NULL;
}

static void keep_empty_slab(Region *slab) {
  if (empty_slab_count < EMPTY_SLABS_KEPT) {
    empty_slabs[empty_slab_count++] = slab;
  } else {
    lerta_os_unmap_region(slab, LERTA_REGION_SIZE);
  }
}

// The place freed last, which is warm in the cache.
static bool takes_free_place(const Region *slab) { return slab->free_first != NULL; }
#endif

// Kept out of lerta_mem_alloc, so that the rest, which most allocations end in, is small enough
// for LLVM to inline into the generated code.
__attribute__((noinline)) static Region *new_slab(int size_class) {
  Region *slab = take_empty_slab();
  if (slab == NULL) slab = map_region(LERTA_REGION_SIZE);
  uint8_t *places = (uint8_t *)slab + PLACES_START;
  *slab = (Region){.place_size = place_size_of(size_class), .fresh = places};
  link_slab(slab, size_class);
  return slab;
}

__attribute__((noinline)) static void *alloc_large(int64_t size) {
  int64_t mask = LERTA_REGION_SIZE - 1;
  int64_t region_size = (PLACES_START + size + mask) & ~mask;
  Region *region = map_region(region_size);
  *region = (Region){.place_size = region_size, .is_large = true};
  return (uint8_t *)region + PLACES_START;
}

void *lerta_mem_alloc(int64_t size) {
  if (size > SLAB_LIMIT) return alloc_large(size);
  int size_class = size_class_of(size);
  Region *slab = slabs_with_room[size_class];
  if (slab == NULL) slab = new_slab(size_class);
  Place *place;
  if (takes_free_place(slab)) {
    place = slab->free_first;
    slab->free_first = place->next;
  } else {
    place = (Place *)slab->fresh;
    slab->fresh += slab->place_size;
  }
  slab->live++;
  if (is_full(slab)) unlink_slab(slab, size_class);
  return place;
}

__attribute__((noinline)) static void free_slab(Region *slab, int size_class) {
  unlink_slab(slab, size_class);
  keep_empty_slab(slab);
}

// A release build puts the place first in the free list, a debug build last (see
// takes_free_place).
void lerta_mem_free(void *memory) {
  Region *region = region_of(memory);
  if (region->is_large) {
    lerta_os_unmap_region(region, region->place_size);
    return;
  }
  int size_class = size_class_of(region->place_size);
  if (is_full(region)) link_slab(region, size_class);
  Place *place = memory;
  place->count = 0;
#ifdef LERTA_DEBUG
  place->next = NULL;
  if (region->free_first == NULL) region->free_first = place;
  else region->free_last->next = place;
  region->free_last = place;
#else
  place->next = region->free_first;
  region->free_first = place;
#endif
  bool is_last_with_room = region->previous == NULL && region->next == NULL;
  if (--region->live == 0 && !is_last_with_room) free_slab(region, size_class);
}

void *lerta_alloc(int64_t size, void (*drop)(void *object)) {
  LertaHeader *object = lerta_mem_alloc(size);
  object->ref_count = 1;
  object->drop = drop;
#ifdef LERTA_DEBUG
  live_objects++;
#endif
  return object;
}

void lerta_free_unfinished(void *object) {
  lerta_mem_free(object);
#ifdef LERTA_DEBUG
  live_objects--;
#endif
}

void *lerta_frame_alloc(int64_t size) {
#ifdef LERTA_DEBUG
  live_objects++;
#endif
  return lerta_checked_malloc((size_t)size);
}

void lerta_frame_free(void *frame) {
  free(frame);
#ifdef LERTA_DEBUG
  live_objects--;
#endif
}

// See docs/internals.md#allocation.
static void check_not_dropped(const LertaHeader *header, const char *message) {
#ifdef LERTA_DEBUG
  if (header->ref_count <= 0) lerta_panic(message);
#else
  (void)header;
  (void)message;
#endif
}

// NULL is nil, which holds no object.
void lerta_retain(void *object) {
  LertaHeader *header = object;
  if (header == NULL || header->ref_count == LERTA_IMMORTAL) return;
  check_not_dropped(header, "retain of a dropped object");
  header->ref_count++;
}

// Objects whose count reaches zero wait here to be dropped and freed. Dropping one releases what
// it owns, which may queue more; a loop, not recursion, handles them, so that a long chain such as
// a linked list does not overflow the stack.
static void **pending = NULL;
static int64_t pending_length = 0;
static int64_t pending_capacity = 0;
static bool draining = false;

static void push_pending(void *object) {
  if (pending_length == pending_capacity) {
    pending_capacity = pending_capacity == 0 ? 64 : pending_capacity * 2;
    pending = lerta_checked_realloc(pending, (size_t)pending_capacity * sizeof(void *));
  }
  pending[pending_length++] = object;
}

// Drops and frees the queued objects until only the first `length` are left.
static void drain_to(int64_t length) {
  while (pending_length > length) {
    LertaHeader *dead = pending[--pending_length];
    if (dead->drop != NULL) dead->drop(dead);
#ifdef LERTA_DEBUG
    live_objects--;
#endif
    lerta_mem_free(dead);
  }
}

// Kept out of lerta_release, so that the rest, which most releases end in, is small enough for
// LLVM to inline into the generated code.
__attribute__((noinline)) static void drop_released(void *object) {
  push_pending(object);
  if (draining) return;
  draining = true;
  drain_to(0);
  draining = false;
}

void lerta_release(void *object) {
  LertaHeader *header = object;
  if (header == NULL || header->ref_count == LERTA_IMMORTAL) return;
  check_not_dropped(header, "release of a dropped object");
  if (--header->ref_count > 0) return;
  drop_released(object);
}

void lerta_run_deinit(void *object, void (*deinit)(void *object)) {
  LertaHeader *header = object;
  header->ref_count = 1;
  int64_t queued_before = pending_length;
  // An exception may be on its way while the object is released; the deinit's code runs without
  // it, and cannot throw one of its own: no code that releases the object could take it.
  LertaException set_aside = lerta_exception;
  lerta_exception = (LertaException){NULL, NULL};
  deinit(object);
  if (lerta_exception.data != NULL) {
    lerta_panic_with("deinit threw an exception: ", lerta_exception_message());
  }
  lerta_exception = set_aside;
  // What deinit released is dropped now, not after it: a temporary that holds the object, such as a
  // closure of a function literal that uses `@`, must have let it go before the check.
  drain_to(queued_before);
  if (header->ref_count != 1) lerta_panic("deinit kept a reference to its object");
}

typedef struct {
  LertaHeader header;
  void *object;
  void **slot;
} LertaWeakBox;

static void drop_weak_box(void *box) {
  LertaWeakBox *weak = box;
  if (weak->object != NULL) *weak->slot = NULL;
}

// The slot of an object being dropped: its box, if it had one, no longer points at it, and a new
// one would not either.
static char dropping;
#define DROPPING ((void *)&dropping)

void *lerta_weak_box(void *object, void **slot) {
  if (*slot != NULL && *slot != DROPPING) {
    lerta_retain(*slot);
    return *slot;
  }
  LertaWeakBox *box = lerta_alloc(sizeof(LertaWeakBox), drop_weak_box);
  box->object = *slot == DROPPING ? NULL : object;
  box->slot = slot;
  if (*slot == NULL) *slot = box;
  return box;
}

void *lerta_weak_object(void *box) {
  return box == NULL ? NULL : ((LertaWeakBox *)box)->object;
}

void lerta_weak_detach(void **slot) {
  LertaWeakBox *box = *slot;
  if (box != NULL) box->object = NULL;
  *slot = DROPPING;
}

void lerta_report_leaks(void) {
#ifdef LERTA_DEBUG
  if (live_objects == 0) return;
  static const uint8_t prefix[] = "leak: ";
  static const uint8_t suffix[] = " object(s)\n";
  uint8_t count[LERTA_INT_TEXT_MAX];
  int64_t start = lerta_format_int(live_objects, count);
  lerta_stderr_write(prefix, sizeof prefix - 1);
  lerta_stderr_write(count + start, LERTA_INT_TEXT_MAX - start);
  lerta_stderr_write(suffix, sizeof suffix - 1);
#endif
}
