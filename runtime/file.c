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
LERTA_STATIC_STRING(cannot_stat, "cannot read the status of: ");
LERTA_STATIC_STRING(cannot_make_link, "cannot make link: ");
LERTA_STATIC_STRING(cannot_copy, "cannot copy file: ");

// Takes the bytes, which may be NULL.
static LertaString *string_of_bytes(uint8_t *bytes, int64_t length) {
  if (bytes == NULL) return NULL;
  LertaString *string = lerta_string_from_bytes(bytes, length);
  free(bytes);
  return string;
}

// The status of what the path names, as lerta_os_stat gives it; a path that holds a NUL byte names
// nothing.
static int stat_of(const LertaString *path, LertaFileStatus *status) {
  char *name = lerta_c_string(path);
  int found = name == NULL ? 0 : lerta_os_stat(name, status);
  free(name);
  return found;
}

bool lerta_is_file(const LertaString *path) {
  LertaFileStatus status;
  return stat_of(path, &status) == 1 && status.kind == LERTA_FILE_KIND;
}

bool lerta_is_dir(const LertaString *path) {
  LertaFileStatus status;
  return stat_of(path, &status) == 1 && status.kind == LERTA_DIR_KIND;
}

// Appends the kind, the size and the time to `fields`, if the path names something.
bool lerta_stat_fields(const LertaString *path, LertaArray *fields) {
  LertaFileStatus status;
  int found = stat_of(path, &status);
  if (found < 0) {
    lerta_raise_with(LERTA_IO_ERROR, &cannot_stat, path);
    return false;
  }
  if (found == 0) return false;
  int64_t values[] = {status.kind, status.size, status.modified_time};
  for (int i = 0; i < 3; i++) lerta_array_append(fields, &values[i]);
  return true;
}

void lerta_make_link(const LertaString *target, const LertaString *path) {
  char *target_name = lerta_c_string(target);
  char *name = lerta_c_string(path);
  bool made = target_name != NULL && name != NULL && lerta_os_make_link(target_name, name);
  free(target_name);
  free(name);
  if (!made) lerta_raise_with(LERTA_IO_ERROR, &cannot_make_link, path);
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
  char *to_name;
  LertaString *data;
  uint8_t *bytes;
  int64_t length;
  bool succeeded;
  bool cancelled;
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

static void copy_work(void *data) {
  FileTask *task = data;
  task->succeeded = lerta_os_copy_file(task->name, task->to_name);
}

// The work on the thread pool cannot be stopped: it goes on, and its end settles nothing.
static void cancel_task(void *context) {
  FileTask *task = context;
  task->cancelled = true;
  lerta_promise_reject_cancelled(task->promise);
}

static void end_task(void *data) {
  FileTask *task = data;
  // On the loop, as a panic touches what only the main thread may.
  if (task->length == LERTA_OUT_OF_MEMORY) lerta_panic("out of memory");
  if (task->cancelled) {
    free(task->bytes);
  } else if (task->succeeded) {
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
  free(task->to_name);
  free(task);
}

// A path that holds a NUL byte fails at once, as does a destination `to`, if given.
static LertaPromise *start_task(LertaItemKind kind, const LertaString *path, const void *failure,
                                const LertaString *data, const LertaString *to,
                                void (*work)(void *data)) {
  LertaPromise *promise = lerta_promise_new(kind);
  char *name = lerta_c_string(path);
  char *to_name = to == NULL ? NULL : lerta_c_string(to);
  if (name == NULL || (to != NULL && to_name == NULL)) {
    free(name);
    free(to_name);
    lerta_raise_with(LERTA_IO_ERROR, failure, path);
    lerta_promise_reject(promise);
    return promise;
  }
  FileTask *task = lerta_checked_calloc(1, sizeof(FileTask));
  *task = (FileTask){.promise = promise, .path = (LertaString *)path, .failure = failure,
                     .name = name, .to_name = to_name, .data = (LertaString *)data};
  lerta_retain(promise);
  lerta_retain((void *)path);
  if (data != NULL) lerta_retain((void *)data);
  lerta_loop_work(task, work, end_task);
  lerta_promise_on_cancel(promise, cancel_task, task);
  return promise;
}

LertaPromise *lerta_read_file_async(const LertaString *path) {
  return start_task(LERTA_REFERENCE_ITEMS, path, &cannot_read, NULL, NULL, read_work);
}

LertaPromise *lerta_write_file_async(const LertaString *path, const LertaString *data) {
  return start_task(LERTA_PLAIN_ITEMS, path, &cannot_write, data, NULL, write_work);
}

LertaPromise *lerta_remove_tree_async(const LertaString *path) {
  return start_task(LERTA_PLAIN_ITEMS, path, &cannot_remove, NULL, NULL, remove_work);
}

LertaPromise *lerta_copy_file_async(const LertaString *from, const LertaString *to) {
  return start_task(LERTA_PLAIN_ITEMS, from, &cannot_copy, NULL, to, copy_work);
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
