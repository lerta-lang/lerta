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

void lerta_release(void *object) {
  LertaHeader *header = object;
  if (header == NULL || header->ref_count == LERTA_IMMORTAL) return;
  if (--header->ref_count > 0) return;
  push_pending(object);
  if (draining) return;
  draining = true;
  while (pending_length > 0) {
    LertaHeader *dead = pending[--pending_length];
    if (dead->drop != NULL) dead->drop(dead);
    free(dead);
#ifdef LERTA_DEBUG
    live_objects--;
#endif
  }
  draining = false;
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
