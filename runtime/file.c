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
LERTA_STATIC_STRING(cannot_open, "cannot open file: ");

// Takes the bytes, which may be NULL.
static LertaString *string_of_bytes(uint8_t *bytes, int64_t length) {
  if (bytes == NULL) return NULL;
  LertaString *string = lerta_string_from_bytes(bytes, length);
  free(bytes);
  return string;
}

// The status of what the path names, as lerta_os_stat gives it.
static int stat_of(const LertaString *path, LertaFileStatus *status) {
  char *name = lerta_c_string(path);
  int found = lerta_os_stat(name, status);
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
    lerta_raise_with(LERTA_IO_ERROR, LERTA_STR(cannot_stat), path);
    return false;
  }
  if (found == 0) return false;
  int64_t values[] = {status.kind, status.size, status.modified_time};
  for (int i = 0; i < 3; i++) lerta_array_append(fields, &values[i]);
  return true;
}

void lerta_make_link(const LertaString *target, const LertaString *path) {
  bool made = lerta_with_c_strings(target, path, lerta_os_make_link);
  if (!made) lerta_raise_with(LERTA_IO_ERROR, LERTA_STR(cannot_make_link), path);
}

// std:io refuses an empty path, which Windows would read `\*` in as the root of the drive.
LertaArray *lerta_list_dir_names(const LertaString *path) {
  char *name = lerta_c_string(path);
  LertaArray *names = lerta_array_create(LERTA_REFERENCE_ITEMS);
  bool listed = lerta_os_list_dir(name, names);
  free(name);
  if (!listed) {
    lerta_release(names);
    lerta_raise_with(LERTA_IO_ERROR, LERTA_STR(cannot_list), path);
    return NULL;
  }
  return names;
}

// Takes a C string that the platform allocated.
static LertaString *string_from_os(char *text) {
  LertaString *result = lerta_string_from_c(text);
  free(text);
  return result;
}

LertaString *lerta_real_path(const LertaString *path) {
  char *name = lerta_c_string(path);
  char *resolved = lerta_os_real_path(name);
  free(name);
  if (resolved == NULL) {
    lerta_raise_with(LERTA_IO_ERROR, LERTA_STR(cannot_resolve), path);
    return NULL;
  }
  return string_from_os(resolved);
}

LertaString *lerta_make_temp_dir(void) {
  char *path = lerta_os_make_temp_dir();
  if (path == NULL) {
    lerta_raise(LERTA_IO_ERROR, LERTA_STR(cannot_make_temp_dir));
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
  const LertaString *failure;
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
    lerta_promise_reject_io(task->promise, task->failure, task->path);
  }
  lerta_release(task->promise);
  lerta_release(task->path);
  if (task->data != NULL) lerta_release(task->data);
  free(task->name);
  free(task->to_name);
  free(task);
}

static LertaPromise *start_task(LertaItemKind kind, const LertaString *path,
                                const LertaString *failure, const LertaString *data,
                                const LertaString *to, void (*work)(void *data)) {
  LertaPromise *promise = lerta_promise_new(kind);
  char *name = lerta_c_string(path);
  char *to_name = to == NULL ? NULL : lerta_c_string(to);
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
  return start_task(LERTA_REFERENCE_ITEMS, path, LERTA_STR(cannot_read), NULL, NULL, read_work);
}

LertaPromise *lerta_write_file_async(const LertaString *path, const LertaString *data) {
  return start_task(LERTA_PLAIN_ITEMS, path, LERTA_STR(cannot_write), data, NULL, write_work);
}

LertaPromise *lerta_remove_tree_async(const LertaString *path) {
  return start_task(LERTA_PLAIN_ITEMS, path, LERTA_STR(cannot_remove), NULL, NULL, remove_work);
}

LertaPromise *lerta_copy_file_async(const LertaString *from, const LertaString *to) {
  return start_task(LERTA_PLAIN_ITEMS, from, LERTA_STR(cannot_copy), NULL, to, copy_work);
}

// A file of std:io's open, which Lerta holds by its address, in a FileWriter, and frees. Each write
// takes the place after the one before, so that a write on the thread pool and the last one, which
// the free makes at once, may run together. Once ended or freed, the file is closed when the writes
// on the thread pool have ended; once freed, the OpenFile is freed then too.
typedef struct {
  int64_t file;
  LertaString *path;
  int64_t end;
  int writes;
  // Set by a write that fails, so that the later ones fail too rather than leave a hole at its
  // place.
  bool failed;
  bool ended;
  bool closed;
  bool freed;
} OpenFile;

// The promise is NULL for the rest that an end writes, which nothing awaits. It has no cancel hook:
// a cancel waits for the write, which libuv cannot stop, so that the flush that awaits it still
// holds it, and a later one waits for it.
typedef struct {
  OpenFile *open;
  LertaPromise *promise;
  LertaString *data;
  int64_t offset;
  bool succeeded;
} FileWrite;

static OpenFile *open_file_of(int64_t pointer) {
  return (OpenFile *)(intptr_t)pointer;
}

static void finish_if_done(OpenFile *open) {
  if (open->writes > 0) return;
  if (open->ended && !open->closed) {
    lerta_os_close(open->file);
    open->closed = true;
  }
  if (!open->freed) return;
  lerta_release(open->path);
  free(open);
}

int64_t lerta_open_for_writing(const LertaString *path) {
  char *name = lerta_c_string(path);
  int64_t file = lerta_os_open_for_writing(name);
  free(name);
  if (file < 0) {
    lerta_raise_with(LERTA_IO_ERROR, LERTA_STR(cannot_open), path);
    return 0;
  }
  OpenFile *open = lerta_checked_calloc(1, sizeof(OpenFile));
  *open = (OpenFile){.file = file, .path = (LertaString *)path};
  lerta_retain((void *)path);
  return (int64_t)(intptr_t)open;
}

// Throws the failure of a write before, if one has failed.
void lerta_open_file_check(int64_t pointer) {
  OpenFile *open = open_file_of(pointer);
  if (open->failed) lerta_raise_with(LERTA_IO_ERROR, LERTA_STR(cannot_write), open->path);
}

// The place of the next `length` bytes, which a write takes.
static int64_t take_place(OpenFile *open, int64_t length) {
  int64_t offset = open->end;
  open->end += length;
  return offset;
}

static void file_write_work(void *data) {
  FileWrite *write = data;
  OpenFile *open = write->open;
  write->succeeded =
      lerta_os_write_at(open->file, write->offset, write->data->bytes, write->data->length);
}

static void end_file_write(void *data) {
  FileWrite *write = data;
  OpenFile *open = write->open;
  if (!write->succeeded) open->failed = true;
  if (write->promise != NULL) {
    if (write->succeeded) {
      lerta_promise_resolve(write->promise);
    } else {
      lerta_promise_reject_io(write->promise, LERTA_STR(cannot_write), open->path);
    }
    lerta_release(write->promise);
  }
  lerta_release(write->data);
  free(write);
  open->writes--;
  finish_if_done(open);
}

static void start_write(OpenFile *open, LertaPromise *promise, const LertaString *data) {
  FileWrite *write = lerta_checked_calloc(1, sizeof(FileWrite));
  *write = (FileWrite){.open = open, .promise = promise, .data = (LertaString *)data,
                       .offset = take_place(open, data->length)};
  lerta_retain((void *)data);
  open->writes++;
  if (promise != NULL) lerta_retain(promise);
  lerta_loop_work(write, file_write_work, end_file_write);
}

LertaPromise *lerta_open_file_write(int64_t pointer, const LertaString *data) {
  LertaPromise *promise = lerta_promise_new(LERTA_PLAIN_ITEMS);
  start_write(open_file_of(pointer), promise, data);
  return promise;
}

// Writes the rest on the thread pool, unless a write is known to have failed by now, and closes the
// file after it.
void lerta_open_file_end(int64_t pointer, const LertaString *rest) {
  OpenFile *open = open_file_of(pointer);
  if (!open->failed && rest->length > 0) start_write(open, NULL, rest);
  open->ended = true;
  finish_if_done(open);
}

// Writes the rest at once, unless the file has ended or a write has failed, as the end of the
// program may come before the loop would run a write; a failure has no one to tell.
void lerta_open_file_free(int64_t pointer, const LertaString *rest) {
  OpenFile *open = open_file_of(pointer);
  if (!open->ended && !open->failed) {
    int64_t offset = take_place(open, rest->length);
    lerta_os_write_at(open->file, offset, rest->bytes, rest->length);
  }
  open->ended = true;
  open->freed = true;
  finish_if_done(open);
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

// std:io refuses an empty path.
void lerta_make_dir(const LertaString *path) {
  char *name = lerta_c_string(path);
  bool made = make_dir_and_parents(name);
  free(name);
  if (!made) lerta_raise_with(LERTA_IO_ERROR, LERTA_STR(cannot_make_dir), path);
}

void lerta_rename(const LertaString *from, const LertaString *to) {
  bool renamed = lerta_with_c_strings(from, to, lerta_os_rename);
  if (!renamed) lerta_raise_with(LERTA_IO_ERROR, LERTA_STR(cannot_rename), from);
}
