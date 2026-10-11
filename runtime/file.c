#include <stdlib.h>
#include <string.h>

#include "lerta.h"

LERTA_STATIC_STRING(cannot_read, "cannot read file: ");
LERTA_STATIC_STRING(cannot_write, "cannot write file: ");
LERTA_STATIC_STRING(cannot_resolve, "cannot resolve path: ");
LERTA_STATIC_STRING(cannot_make_temp_dir, "cannot make a temporary directory");
LERTA_STATIC_STRING(cannot_remove, "cannot remove: ");

LertaString *lerta_read_file(const LertaString *path) {
  char *name = lerta_c_string(path);
  LertaString *contents = name == NULL ? NULL : lerta_os_read_file(name);
  free(name);
  if (contents == NULL) lerta_raise_with(LERTA_IO_ERROR, &cannot_read, path);
  return contents;
}

void lerta_write_file(const LertaString *path, const LertaString *data) {
  char *name = lerta_c_string(path);
  bool written = name != NULL && lerta_os_write_file(name, data->bytes, data->length);
  free(name);
  if (!written) lerta_raise_with(LERTA_IO_ERROR, &cannot_write, path);
}

bool lerta_is_file(const LertaString *path) {
  char *name = lerta_c_string(path);
  bool is_file = name != NULL && lerta_os_is_file(name);
  free(name);
  return is_file;
}

// Takes a C string that the platform allocated.
static LertaString *string_from_os(char *text) {
  LertaString *result = lerta_string_from_bytes(text, (int64_t)strlen(text));
  free(text);
  return result;
}

LertaString *lerta_real_path(const LertaString *path) {
  char *name = lerta_c_string(path);
  char *resolved = name == NULL ? NULL : lerta_os_real_path(name);
  free(name);
  if (resolved == NULL) {
    lerta_raise_with(LERTA_IO_ERROR, &cannot_resolve, path);
    return NULL;
  }
  return string_from_os(resolved);
}

LertaString *lerta_make_temp_dir(void) {
  char *path = lerta_os_make_temp_dir();
  if (path == NULL) {
    lerta_raise(LERTA_IO_ERROR, (const LertaString *)&cannot_make_temp_dir);
    return NULL;
  }
  return string_from_os(path);
}

void lerta_remove_tree(const LertaString *path) {
  char *name = lerta_c_string(path);
  bool removed = name != NULL && lerta_os_remove_tree(name);
  free(name);
  if (!removed) lerta_raise_with(LERTA_IO_ERROR, &cannot_remove, path);
}

// Reads in chunks, so that files whose size is not known in advance work too.
LertaString *lerta_read_chunks(int64_t (*read)(void *file, uint8_t *buffer, int64_t size),
                               void *file) {
  int64_t capacity = 4096;
  int64_t length = 0;
  uint8_t *bytes = lerta_checked_malloc((size_t)capacity);
  for (;;) {
    if (length == capacity) {
      capacity *= 2;
      bytes = lerta_checked_realloc(bytes, (size_t)capacity);
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
