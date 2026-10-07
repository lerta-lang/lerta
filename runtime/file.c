#include <errno.h>
#include <fcntl.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#include "lerta.h"

LERTA_STATIC_STRING(cannot_read, "cannot read file: ");
LERTA_STATIC_STRING(cannot_write, "cannot write file: ");

// The path as a NUL-terminated C string, which the caller frees; NULL if the path holds a NUL
// byte, which C would take as its end, naming a different file.
static char *c_path(const LertaString *path) {
  if (memchr(path->bytes, '\0', (size_t)path->length) != NULL) return NULL;
  char *result = malloc((size_t)path->length + 1);
  if (result == NULL) lerta_panic("out of memory");
  memcpy(result, path->bytes, (size_t)path->length);
  result[path->length] = '\0';
  return result;
}

_Noreturn static void throw_file_error(const void *prefix, const LertaString *path) {
  lerta_throw(lerta_string_concat(2, prefix, path));
}

// Reads in chunks, so that files whose size is not known in advance work too.
LertaString *lerta_read_file(const LertaString *path) {
  char *name = c_path(path);
  int fd = name == NULL ? -1 : open(name, O_RDONLY);
  free(name);
  if (fd < 0) throw_file_error(&cannot_read, path);
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
    ssize_t count = read(fd, bytes + length, (size_t)(capacity - length));
    if (count < 0 && errno == EINTR) continue;
    if (count == 0) break;
    if (count < 0) {
      close(fd);
      throw_file_error(&cannot_read, path);
    }
    length += count;
  }
  close(fd);
  LertaString *result = lerta_alloc((int64_t)sizeof(LertaString) + length, NULL);
  result->length = length;
  memcpy(result->bytes, bytes, (size_t)length);
  free(bytes);
  return result;
}

void lerta_write_file(const LertaString *path, const LertaString *data) {
  char *name = c_path(path);
  int fd = name == NULL ? -1 : open(name, O_WRONLY | O_CREAT | O_TRUNC, 0644);
  free(name);
  if (fd < 0) throw_file_error(&cannot_write, path);
  int64_t written = 0;
  while (written < data->length) {
    ssize_t count = write(fd, data->bytes + written, (size_t)(data->length - written));
    if (count < 0 && errno == EINTR) continue;
    if (count <= 0) {
      close(fd);
      throw_file_error(&cannot_write, path);
    }
    written += count;
  }
  close(fd);
}
