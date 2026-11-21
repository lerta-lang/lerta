#include <stdlib.h>

#include "internal.h"

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

void *lerta_grow_buffer(void *items, int64_t *capacity, size_t item_size, int64_t first) {
  *capacity = *capacity == 0 ? first : *capacity * 2;
  return lerta_checked_realloc(items, (size_t)*capacity * item_size);
}

void *lerta_checked_calloc(size_t count, size_t size) {
  void *memory = calloc(count, size);
  if (memory == NULL) lerta_panic("out of memory");
  return memory;
}

// The globals that lerta_keep_until_exit registers.
static void ***kept = NULL;
static int64_t kept_length = 0;
static int64_t kept_capacity = 0;

void lerta_keep_until_exit(void **slot) {
  if (kept_length == kept_capacity) {
    kept = lerta_grow_buffer(kept, &kept_capacity, sizeof(void **), 8);
  }
  kept[kept_length++] = slot;
}

// Each global is unset before its release, so that what a deinit that the release runs reads of
// it is nil rather than a released object.
void lerta_release_kept(void) {
  for (int64_t i = 0; i < kept_length; i++) {
    void *object = *kept[i];
    *kept[i] = NULL;
    lerta_release(object);
  }
  kept_length = 0;
}

static LertaHeader *allocate_object(int64_t size) {
#ifdef LERTA_DEBUG
  LertaPrefix *prefix = lerta_mem_alloc((int64_t)sizeof(LertaPrefix) + size);
  lerta_track(prefix);
  LertaHeader *object = (LertaHeader *)(prefix + 1);
#else
  LertaHeader *object = lerta_mem_alloc(size);
#endif
  object->ref_count = 1;
  return object;
}

static void free_object(void *object) {
  lerta_trace_forget(object);
  lerta_forget_late_nan(object);
#ifdef LERTA_DEBUG
  // The count follows the prefix, where the allocator fills a freed place with FREED_BYTE; but
  // where pointers are 4 bytes, the prefix is 8 bytes, and the count lies in the place's next 8,
  // which hold its free-list link and are not filled (see
  // docs/internals/memory.md#use-after-drop-checking).
  ((LertaHeader *)object)->ref_count = 0;
  LertaPrefix *prefix = (LertaPrefix *)object - 1;
  lerta_untrack(prefix);
  lerta_mem_free(prefix);
#else
  lerta_mem_free(object);
#endif
}

// Kept out of lerta_grow, so that the rest, which most calls end in, is short enough for LLVM to
// inline into the generated code, as a loop of `+=` grows a String or a Binary.
__attribute__((noinline)) static void *move_to_room(void *object, int64_t size) {
#ifdef LERTA_DEBUG
  LertaPrefix *prefix = (LertaPrefix *)object - 1;
  // The neighbours in the list of objects alive point at the prefix, which may move.
  lerta_untrack(prefix);
  prefix = lerta_mem_realloc(prefix, 2 * ((int64_t)sizeof(LertaPrefix) + size));
  lerta_track(prefix);
  return prefix + 1;
#else
  return lerta_mem_realloc(object, 2 * size);
#endif
}

bool lerta_has_room(void *object, int64_t size) {
#ifdef LERTA_DEBUG
  return (int64_t)sizeof(LertaPrefix) + size <= lerta_mem_capacity((LertaPrefix *)object - 1);
#else
  return size <= lerta_mem_capacity(object);
#endif
}

void *lerta_grow(void *object, int64_t size) {
  if (lerta_has_room(object, size)) return object;
  return move_to_room(object, size);
}

void *lerta_new(int64_t size, const LertaType *type) {
  LertaHeader *object = allocate_object(size);
  object->type = type;
  return object;
}

void *lerta_frame_alloc(int64_t size) {
#ifdef LERTA_DEBUG
  lerta_track_frame();
#endif
  return lerta_mem_alloc((size + 15) & ~(int64_t)15);
}

void lerta_frame_free(void *frame) {
  lerta_mem_free(frame);
#ifdef LERTA_DEBUG
  lerta_untrack_frame();
#endif
}

// See docs/internals/memory.md#allocation.
static void check_not_dropped(const LertaHeader *header, const char *message) {
#ifdef LERTA_DEBUG
  if (header->ref_count <= 0) lerta_panic(message);
#else
  (void)header;
  (void)message;
#endif
}

void lerta_retain(void *object) {
  LertaHeader *header = object;
  if (header == NULL || header->ref_count == LERTA_IMMORTAL) return;
  check_not_dropped(header, "retain of a dropped object");
  header->ref_count++;
}

static void **pending = NULL;
static int64_t pending_length = 0;
static int64_t pending_capacity = 0;
static bool draining = false;

static void push_pending(void *object) {
  if (pending_length == pending_capacity) {
    pending = lerta_grow_buffer(pending, &pending_capacity, sizeof(void *), 64);
  }
  pending[pending_length++] = object;
}

static void drop_and_free(LertaHeader *dead) {
  if (dead->type != NULL) dead->type->drop(dead);
  free_object(dead);
}

// Drops and frees the queued objects until only the first `length` are left.
static void drain_to(int64_t length) {
  while (pending_length > length) drop_and_free(pending[--pending_length]);
}

// An object released while another is dropped is queued, so that a long chain is dropped in a loop
// rather than in a recursion as deep. The first is dropped at once, without the queue, as most
// releases drop one object alone.
__attribute__((noinline)) static void drop_released(void *object) {
  if (draining) {
    push_pending(object);
    return;
  }
  draining = true;
  drop_and_free(object);
  drain_to(0);
  draining = false;
}

int64_t lerta_drop_mark(void) { return pending_length; }

#ifdef LERTA_DEBUG
void lerta_visit_pending(LertaVisitor visitor) {
  for (int64_t i = 0; i < pending_length; i++) visitor(pending[i]);
}
#endif

void lerta_free_unfinished(void *object, void **weak_slot, int64_t mark) {
  // A field released while a drop goes on, as in a constructor that a deinit calls, is queued: it
  // may still hold the object until it is dropped.
  drain_to(mark);
  LertaHeader *header = object;
  if (header->ref_count != 1) {
    lerta_panic_with_exception("init threw an exception after its object escaped: ");
  }
  if (weak_slot != NULL) lerta_weak_detach(weak_slot);
  free_object(object);
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
  LertaException set_aside = lerta_exception;
  // An exception that deinit throws and catches would replace the trace of the one set aside.
  LertaTrace *set_aside_trace = set_aside.data != NULL ? lerta_trace_save() : NULL;
  lerta_exception = (LertaException){NULL, NULL};
  deinit(object);
  if (lerta_exception.data != NULL) {
    lerta_panic_with_exception("deinit threw an exception: ");
  }
  lerta_exception = set_aside;
  if (set_aside_trace != NULL) lerta_trace_restore(set_aside_trace);
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

// A weak box does not count its object.
static void visit_weak_box(void *box, LertaVisitor visitor) {
  (void)box;
  (void)visitor;
}

LERTA_STATIC_STRING(weak_box_name, "weak box");
static const LertaType weak_box_type = {
    drop_weak_box, visit_weak_box, LERTA_STR(weak_box_name)};

// The slot of an object being dropped: its box, if it had one, no longer points at it, and a new
// one would not either.
static char dropping;
#define DROPPING ((void *)&dropping)

// A box whose count is 0 is queued to be dropped (see drop_released): the slot takes a new one, and
// the queued box lets go of the slot, which its drop would otherwise clear after the new box took it.
void *lerta_weak_box(void *object, void **slot) {
  LertaWeakBox *current = *slot;
  if (current != NULL && current != DROPPING) {
    if (current->header.ref_count > 0) {
      lerta_retain(current);
      return current;
    }
    current->object = NULL;
  }
  LertaWeakBox *box = lerta_new(sizeof(LertaWeakBox), &weak_box_type);
  box->object = *slot == DROPPING ? NULL : object;
  box->slot = slot;
  if (*slot != DROPPING) *slot = box;
  return box;
}

// An object whose count is 0 is queued to be dropped (see drop_released): it is gone, so that no
// reference brings it back to be queued twice.
void *lerta_weak_object(void *box) {
  if (box == NULL) return NULL;
  LertaHeader *object = ((LertaWeakBox *)box)->object;
  return object != NULL && object->ref_count == 0 ? NULL : object;
}

void lerta_weak_detach(void **slot) {
  LertaWeakBox *box = *slot;
  if (box != NULL) box->object = NULL;
  *slot = DROPPING;
}
