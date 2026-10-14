#include <stddef.h>
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

#ifdef LERTA_DEBUG
// A debug runtime puts the size of each object before it, in room that keeps the object aligned as
// malloc aligns it, to bound the memory of the dropped objects that it keeps (below).
typedef union {
  int64_t size;
  max_align_t alignment;
} SizePrefix;

static SizePrefix *prefix_of(void *object) { return (SizePrefix *)object - 1; }

static void *alloc_object(int64_t size) {
  SizePrefix *prefix = lerta_checked_malloc(sizeof(SizePrefix) + (size_t)size);
  prefix->size = size;
  return prefix + 1;
}

static void free_object(void *object) { free(prefix_of(object)); }
#else
static void *alloc_object(int64_t size) { return lerta_checked_malloc((size_t)size); }

static void free_object(void *object) { free(object); }
#endif

void *lerta_alloc(int64_t size, void (*drop)(void *object)) {
  LertaHeader *object = alloc_object(size);
  object->ref_count = 1;
  object->drop = drop;
#ifdef LERTA_DEBUG
  live_objects++;
#endif
  return object;
}

void lerta_free_unfinished(void *object) {
  free_object(object);
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

// See docs/internals.md#use-after-drop-checking.
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

#ifdef LERTA_DEBUG
// The objects dropped last, oldest first, which a debug runtime keeps from being freed (see
// docs/internals.md#use-after-drop-checking), up to a count, a power of 2 so that a place wraps around it
// with a mask, and a size in all.
#define KEPT_MAX_COUNT (1 << 20)
#define KEPT_MAX_BYTES ((int64_t)16 << 20)
static void *kept[KEPT_MAX_COUNT];
static int64_t kept_first = 0;
static int64_t kept_count = 0;
static int64_t kept_bytes = 0;

static void free_oldest_kept(void) {
  void *oldest = kept[kept_first++ & (KEPT_MAX_COUNT - 1)];
  kept_count--;
  kept_bytes -= prefix_of(oldest)->size;
  free_object(oldest);
}

// Keeps the object, freeing the oldest ones as it needs room; one object larger than the whole size
// is kept alone. Its count is 0 again, also when a deinit has run, which sets it to 1.
static void keep_dropped(LertaHeader *object) {
  object->ref_count = 0;
  int64_t size = prefix_of(object)->size;
  while (kept_count == KEPT_MAX_COUNT || (kept_count > 0 && kept_bytes + size > KEPT_MAX_BYTES)) {
    free_oldest_kept();
  }
  kept[(kept_first + kept_count) & (KEPT_MAX_COUNT - 1)] = object;
  kept_count++;
  kept_bytes += size;
}
#endif

// Drops and frees the queued objects until only the first `length` are left.
static void drain_to(int64_t length) {
  while (pending_length > length) {
    LertaHeader *dead = pending[--pending_length];
    if (dead->drop != NULL) dead->drop(dead);
#ifdef LERTA_DEBUG
    live_objects--;
    keep_dropped(dead);
#else
    free_object(dead);
#endif
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
