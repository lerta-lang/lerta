#include <stdlib.h>
#include <string.h>

#include "lerta.h"

LERTA_STATIC_STRING(cannot_read, "cannot read file: ");
LERTA_STATIC_STRING(cannot_write, "cannot write file: ");
LERTA_STATIC_STRING(cannot_resolve, "cannot resolve path: ");

_Noreturn static void throw_file_error(const void *prefix, const LertaString *path) {
  lerta_throw(lerta_string_concat(2, prefix, path));
}

LertaString *lerta_read_file(const LertaString *path) {
  char *name = lerta_c_string(path);
  LertaString *contents = name == NULL ? NULL : lerta_os_read_file(name);
  free(name);
  if (contents == NULL) throw_file_error(&cannot_read, path);
  return contents;
}

void lerta_write_file(const LertaString *path, const LertaString *data) {
  char *name = lerta_c_string(path);
  bool written = name != NULL && lerta_os_write_file(name, data->bytes, data->length);
  free(name);
  if (!written) throw_file_error(&cannot_write, path);
}

bool lerta_is_file(const LertaString *path) {
  char *name = lerta_c_string(path);
  bool is_file = name != NULL && lerta_os_is_file(name);
  free(name);
  return is_file;
}

LertaString *lerta_real_path(const LertaString *path) {
  char *name = lerta_c_string(path);
  char *resolved = name == NULL ? NULL : lerta_os_real_path(name);
  free(name);
  if (resolved == NULL) throw_file_error(&cannot_resolve, path);
  LertaString *result = lerta_string_from_bytes(resolved, (int64_t)strlen(resolved));
  free(resolved);
  return result;
}

// Reads in chunks, so that files whose size is not known in advance work too.
LertaString *lerta_read_chunks(int64_t (*read)(void *file, uint8_t *buffer, int64_t size),
                               void *file) {
  int64_t capacity = 4096;
  int64_t length = 0;
  uint8_t *bytes = malloc((size_t)capacity);
  if (bytes == NULL) lerta_panic("out of memory");
  for (;;) {
    if (length == capacity) {
      capacity *= 2;
      bytes = realloc(bytes, (size_t)capacity);
      if (bytes == NULL) lerta_panic("out of memory");
    }
    int64_t count = read(file, bytes + length, capacity - length);
    if (count == 0) break;
    if (count < 0) {
      free(bytes);
      return NULL;
    }
    length += count;
  }
  LertaString *result = lerta_string_from_bytes(bytes, length);
  free(bytes);
  return result;
}
