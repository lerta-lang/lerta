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

void lerta_retain(void *object) {
  LertaHeader *header = object;
  if (header->ref_count != LERTA_IMMORTAL) header->ref_count++;
}

void lerta_release(void *object) {
  LertaHeader *header = object;
  if (header->ref_count == LERTA_IMMORTAL) return;
  if (--header->ref_count > 0) return;
  if (header->drop != NULL) header->drop(object);
  free(object);
#ifdef LERTA_DEBUG
  live_objects--;
#endif
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
