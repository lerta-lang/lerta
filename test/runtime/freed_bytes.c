// The debug runtime fills what an object held, and a buffer past its free-list link, with 0xDB
// bytes as it frees them.
#include <stdio.h>

#include "internal.h"

typedef struct {
  LertaHeader header;
  uint8_t fields[24];
} Object;

static void expect_freed(const char *what, const uint8_t *bytes, size_t count) {
  for (size_t i = 0; i < count; i++) {
    if (bytes[i] != 0xDB) fprintf(stderr, "%s: byte %zu is %d\n", what, i, bytes[i]);
  }
}

void lerta_main(void) {
  Object *object = lerta_new(sizeof(Object), NULL);
  memset(object->fields, 1, sizeof object->fields);
  lerta_release(object);
  expect_freed("object", object->fields, sizeof object->fields);

  uint8_t *buffer = lerta_mem_alloc(64);
  memset(buffer, 1, 64);
  lerta_mem_free(buffer);
  expect_freed("buffer", buffer + 16, 64 - 16);
}
