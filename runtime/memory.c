#include <stdlib.h>
#include <string.h>

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
// What the debug runtime keeps before each object; its size keeps the object aligned as its place.
typedef struct {
  // Whether lerta_alloc made the object, as the code that the seed's compiler generates does: its
  // header holds its drop function in place of its type.
  _Alignas(16) bool legacy;
} Prefix;

static Prefix *prefix_of(const void *object) { return (Prefix *)object - 1; }
#endif

static LertaHeader *allocate_object(int64_t size) {
#ifdef LERTA_DEBUG
  live_objects++;
  Prefix *prefix = lerta_mem_alloc((int64_t)sizeof(Prefix) + size);
  prefix->legacy = false;
  LertaHeader *object = (LertaHeader *)(prefix + 1);
#else
  LertaHeader *object = lerta_mem_alloc(size);
#endif
  object->ref_count = 1;
  return object;
}

static void free_object(void *object) {
  lerta_trace_forget(object);
#ifdef LERTA_DEBUG
  live_objects--;
  // The allocator keeps the count of a free place at 0 (see docs/internals.md#allocation), but the
  // prefix comes first in it.
  ((LertaHeader *)object)->ref_count = 0;
  lerta_mem_free(prefix_of(object));
#else
  lerta_mem_free(object);
#endif
}

void *lerta_new(int64_t size, const LertaType *type) {
  LertaHeader *object = allocate_object(size);
  object->type = type;
  return object;
}

#ifdef LERTA_DEBUG
void *lerta_alloc(int64_t size, void (*drop)(void *object)) {
  LertaHeader *object = allocate_object(size);
  prefix_of(object)->legacy = true;
  memcpy(&object->type, &drop, sizeof drop);
  return object;
}
#endif

static void drop_object(LertaHeader *object) {
#ifdef LERTA_DEBUG
  if (prefix_of(object)->legacy) {
    void (*drop)(void *object);
    memcpy(&drop, &object->type, sizeof drop);
    if (drop != NULL) drop(object);
    return;
  }
#endif
  if (object->type != NULL) object->type->drop(object);
}

void *lerta_frame_alloc(int64_t size) {
#ifdef LERTA_DEBUG
  live_objects++;
#endif
  return lerta_mem_alloc((size + 15) & ~(int64_t)15);
}

void lerta_frame_free(void *frame) {
  lerta_mem_free(frame);
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
    pending_capacity = pending_capacity == 0 ? 64 : pending_capacity * 2;
    pending = lerta_checked_realloc(pending, (size_t)pending_capacity * sizeof(void *));
  }
  pending[pending_length++] = object;
}

// Drops and frees the queued objects until only the first `length` are left.
static void drain_to(int64_t length) {
  while (pending_length > length) {
    LertaHeader *dead = pending[--pending_length];
    drop_object(dead);
    free_object(dead);
  }
}

__attribute__((noinline)) static void drop_released(void *object) {
  push_pending(object);
  if (draining) return;
  draining = true;
  drain_to(0);
  draining = false;
}

int64_t lerta_drop_mark(void) { return pending_length; }

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
    drop_weak_box, visit_weak_box, (const LertaString *)&weak_box_name};

// The slot of an object being dropped: its box, if it had one, no longer points at it, and a new
// one would not either.
static char dropping;
#define DROPPING ((void *)&dropping)

void *lerta_weak_box(void *object, void **slot) {
  if (*slot != NULL && *slot != DROPPING) {
    lerta_retain(*slot);
    return *slot;
  }
  LertaWeakBox *box = lerta_new(sizeof(LertaWeakBox), &weak_box_type);
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
