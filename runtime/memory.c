#include <stdlib.h>

#include "lerta.h"

#ifdef LERTA_DEBUG
static int64_t live_objects = 0;
#endif

void *lerta_alloc(int64_t size, void (*drop)(void *object)) {
  LertaHeader *object = malloc((size_t)size);
  if (object == NULL) lerta_panic("out of memory");
  object->ref_count = 1;
  object->drop = drop;
#ifdef LERTA_DEBUG
  live_objects++;
#endif
  return object;
}

// NULL is nil, which holds no object.
void lerta_retain(void *object) {
  LertaHeader *header = object;
  if (header != NULL && header->ref_count != LERTA_IMMORTAL) header->ref_count++;
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
    pending = realloc(pending, (size_t)pending_capacity * sizeof(void *));
    if (pending == NULL) lerta_panic("out of memory");
  }
  pending[pending_length++] = object;
}

// Drops and frees the queued objects until only the first `length` are left.
static void drain_to(int64_t length) {
  while (pending_length > length) {
    LertaHeader *dead = pending[--pending_length];
    if (dead->drop != NULL) dead->drop(dead);
    free(dead);
#ifdef LERTA_DEBUG
    live_objects--;
#endif
  }
}

void lerta_release(void *object) {
  LertaHeader *header = object;
  if (header == NULL || header->ref_count == LERTA_IMMORTAL) return;
  if (--header->ref_count > 0) return;
  push_pending(object);
  if (draining) return;
  draining = true;
  drain_to(0);
  draining = false;
}

void lerta_run_deinit(void *object, void (*deinit)(void *object)) {
  LertaHeader *header = object;
  header->ref_count = 1;
  int64_t queued_before = pending_length;
  deinit(object);
  // What deinit released is dropped now, not after it: a temporary that holds the object, such as a
  // closure of a function literal that uses `@`, must have let it go before the check.
  drain_to(queued_before);
  if (header->ref_count != 1) lerta_panic("deinit kept a reference to its object");
}

bool lerta_check_leaks(void) {
#ifdef LERTA_DEBUG
  if (live_objects == 0) return true;
  static const uint8_t prefix[] = "leak: ";
  static const uint8_t suffix[] = " object(s)\n";
  uint8_t count[LERTA_INT_TEXT_MAX];
  int64_t start = lerta_format_int(live_objects, count);
  lerta_stderr_write(prefix, sizeof prefix - 1);
  lerta_stderr_write(count + start, LERTA_INT_TEXT_MAX - start);
  lerta_stderr_write(suffix, sizeof suffix - 1);
  return false;
#else
  return true;
#endif
}
