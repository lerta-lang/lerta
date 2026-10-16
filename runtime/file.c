#include <stdlib.h>
#include <string.h>

#include "internal.h"

LERTA_STATIC_STRING(cannot_read, "cannot read file: ");
LERTA_STATIC_STRING(cannot_write, "cannot write file: ");
LERTA_STATIC_STRING(cannot_resolve, "cannot resolve path: ");
LERTA_STATIC_STRING(cannot_make_temp_dir, "cannot make a temporary directory");
LERTA_STATIC_STRING(cannot_remove, "cannot remove: ");
LERTA_STATIC_STRING(cannot_make_dir, "cannot make directory: ");
LERTA_STATIC_STRING(cannot_rename, "cannot rename: ");
LERTA_STATIC_STRING(cannot_list, "cannot list directory: ");

// Takes the bytes, which may be NULL.
static LertaString *string_of_bytes(uint8_t *bytes, int64_t length) {
  if (bytes == NULL) return NULL;
  LertaString *string = lerta_string_from_bytes(bytes, length);
  free(bytes);
  return string;
}

bool lerta_is_file(const LertaString *path) {
  char *name = lerta_c_string(path);
  bool is_file = name != NULL && lerta_os_is_file(name);
  free(name);
  return is_file;
}

bool lerta_is_dir(const LertaString *path) {
  char *name = lerta_c_string(path);
  bool is_dir = name != NULL && lerta_os_is_dir(name);
  free(name);
  return is_dir;
}

// An empty path is refused here, as Windows would read `\*` in it as the root of the drive.
LertaArray *lerta_list_dir_names(const LertaString *path) {
  char *name = lerta_c_string(path);
  LertaArray *names = lerta_array_create(LERTA_REFERENCE_ITEMS);
  bool listed = name != NULL && name[0] != '\0' && lerta_os_list_dir(name, names);
  free(name);
  if (!listed) {
    lerta_release(names);
    lerta_raise_with(LERTA_IO_ERROR, &cannot_list, path);
    return NULL;
  }
  return names;
}

void lerta_append_c_string(LertaArray *array, const char *text) {
  LertaString *string = lerta_string_from_bytes(text, (int64_t)strlen(text));
  lerta_array_append(array, &string);
  lerta_release(string);
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

// A read, write or removal on libuv's thread pool (see docs/internals.md#files). It holds the
// promise, the path and the data until it is done; the worker touches only `name`, the data's bytes,
// which stay as they are, as a String or a Binary is immutable and the task keeps it alive, and
// what it reads, allocated with malloc.
typedef struct {
  LertaPromise *promise;
  LertaString *path;
  const void *failure;
  char *name;
  LertaString *data;
  uint8_t *bytes;
  int64_t length;
  bool succeeded;
} FileTask;

static void read_work(void *data) {
  FileTask *task = data;
  task->bytes = lerta_os_read_file(task->name, &task->length);
  task->succeeded = task->bytes != NULL;
}

static void write_work(void *data) {
  FileTask *task = data;
  task->succeeded = lerta_os_write_file(task->name, task->data->bytes, task->data->length);
}

static void remove_work(void *data) {
  FileTask *task = data;
  task->succeeded = lerta_os_remove_tree(task->name);
}

static void end_task(void *data) {
  FileTask *task = data;
  // On the loop, as a panic touches what only the main thread may.
  if (task->length == LERTA_OUT_OF_MEMORY) lerta_panic("out of memory");
  if (task->succeeded) {
    if (task->bytes != NULL) {
      *(LertaString **)lerta_promise_slot(task->promise) =
          string_of_bytes(task->bytes, task->length);
    }
    lerta_promise_resolve(task->promise);
  } else {
    lerta_raise_with(LERTA_IO_ERROR, task->failure, task->path);
    lerta_promise_reject(task->promise);
  }
  lerta_release(task->promise);
  lerta_release(task->path);
  if (task->data != NULL) lerta_release(task->data);
  free(task->name);
  free(task);
}

// A path that holds a NUL byte fails at once.
static LertaPromise *start_task(LertaItemKind kind, const LertaString *path, const void *failure,
                                const LertaString *data, void (*work)(void *data)) {
  LertaPromise *promise = lerta_promise_new(kind);
  char *name = lerta_c_string(path);
  if (name == NULL) {
    lerta_raise_with(LERTA_IO_ERROR, failure, path);
    lerta_promise_reject(promise);
    return promise;
  }
  FileTask *task = lerta_checked_calloc(1, sizeof(FileTask));
  *task = (FileTask){.promise = promise, .path = (LertaString *)path, .failure = failure,
                     .name = name, .data = (LertaString *)data};
  lerta_retain(promise);
  lerta_retain((void *)path);
  if (data != NULL) lerta_retain((void *)data);
  lerta_loop_work(task, work, end_task);
  return promise;
}

LertaPromise *lerta_read_file_async(const LertaString *path) {
  return start_task(LERTA_REFERENCE_ITEMS, path, &cannot_read, NULL, read_work);
}

LertaPromise *lerta_write_file_async(const LertaString *path, const LertaString *data) {
  return start_task(LERTA_PLAIN_ITEMS, path, &cannot_write, data, write_work);
}

LertaPromise *lerta_remove_tree_async(const LertaString *path) {
  return start_task(LERTA_PLAIN_ITEMS, path, &cannot_remove, NULL, remove_work);
}

// Each directory that ends before a separator is made first; only whether the whole path is a
// directory at the end decides, since a parent that cannot be made, such as a drive or a network
// share on Windows, may be there.
static bool make_dir_and_parents(char *path) {
  for (size_t i = 1; path[i] != '\0'; i++) {
    if (!lerta_os_is_separator(path[i]) || lerta_os_is_separator(path[i - 1])) continue;
    char separator = path[i];
    path[i] = '\0';
    lerta_os_make_dir(path);
    path[i] = separator;
  }
  return lerta_os_make_dir(path);
}

void lerta_make_dir(const LertaString *path) {
  char *name = lerta_c_string(path);
  bool made = name != NULL && name[0] != '\0' && make_dir_and_parents(name);
  free(name);
  if (!made) lerta_raise_with(LERTA_IO_ERROR, &cannot_make_dir, path);
}

void lerta_rename(const LertaString *from, const LertaString *to) {
  char *from_name = lerta_c_string(from);
  char *to_name = lerta_c_string(to);
  bool renamed = from_name != NULL && to_name != NULL && lerta_os_rename(from_name, to_name);
  free(from_name);
  free(to_name);
  if (!renamed) lerta_raise_with(LERTA_IO_ERROR, &cannot_rename, from);
}

// Reads in chunks, so that files whose size is not known in advance work too.
uint8_t *lerta_read_chunks(int64_t (*read)(void *file, uint8_t *buffer, int64_t size), void *file,
                           int64_t *length_read) {
  int64_t capacity = 4096;
  int64_t length = 0;
  uint8_t *bytes = malloc((size_t)capacity);
  for (;;) {
    if (bytes != NULL && length == capacity) {
      capacity *= 2;
      uint8_t *grown = (uint64_t)capacity > SIZE_MAX ? NULL : realloc(bytes, (size_t)capacity);
      if (grown == NULL) free(bytes);
      bytes = grown;
    }
    if (bytes == NULL) {
      *length_read = LERTA_OUT_OF_MEMORY;
      return NULL;
    }
    int64_t count = read(file, bytes + length, capacity - length);
    if (count == 0) break;
    if (count < 0) {
      free(bytes);
      *length_read = 0;
      return NULL;
    }
    length += count;
  }
  *length_read = length;
  return bytes;
}
