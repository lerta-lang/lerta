#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <uv.h>

#include "internal.h"

// The platform functions that libuv makes the same on every system, through its synchronous file
// system calls, which take no loop and no callback (see docs/internals/platforms.md#platforms).

static uv_file open_file(const char *path, int flags, int mode) {
  uv_fs_t request;
  int file = uv_fs_open(NULL, &request, path, flags, mode, NULL);
  uv_fs_req_cleanup(&request);
  return file;
}

static void close_file(uv_file file) {
  uv_fs_t request;
  uv_fs_close(NULL, &request, file, NULL);
  uv_fs_req_cleanup(&request);
}

// Reads a file to its end through `read`, which returns how many bytes it put in `buffer`, 0 at the
// end, or -1 on failure, as lerta_os_read_file returns the bytes. It reads in chunks, so that files
// whose size is not known in advance work too.
static uint8_t *read_chunks(int64_t (*read)(void *file, uint8_t *buffer, int64_t size), void *file,
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

static int64_t read_file(void *file, uint8_t *buffer, int64_t size) {
  uv_buf_t chunk = uv_buf_init((char *)buffer, (unsigned int)lerta_io_chunk(size));
  uv_fs_t request;
  int64_t count = uv_fs_read(NULL, &request, (uv_file)(intptr_t)file, &chunk, 1, -1, NULL);
  uv_fs_req_cleanup(&request);
  return count < 0 ? -1 : count;
}

static bool is_file_mode(uint64_t mode) { return (mode & S_IFMT) == S_IFREG; }

static bool is_dir_mode(uint64_t mode) { return (mode & S_IFMT) == S_IFDIR; }

// A file that is not regular is refused, as a FIFO without a writer would block a worker, and a
// device such as /dev/zero would fill the memory. The file is opened without blocking, so that a
// FIFO does not wait for a writer, and checked by its descriptor, so that the path cannot be
// replaced between the check and the read.
static bool is_regular(uv_file file) {
  uv_fs_t request;
  bool regular = uv_fs_fstat(NULL, &request, file, NULL) == 0 && is_file_mode(request.statbuf.st_mode);
  uv_fs_req_cleanup(&request);
  return regular;
}

uint8_t *lerta_os_read_file(const char *path, int64_t *length) {
  uv_file file = open_file(path, UV_FS_O_RDONLY | UV_FS_O_NONBLOCK, 0);
  if (file < 0) return NULL;
  uint8_t *contents = is_regular(file) ? read_chunks(read_file, (void *)(intptr_t)file, length) : NULL;
  close_file(file);
  return contents;
}

// From `offset`, or from the file's position if it is -1.
static bool write_all(uv_file file, int64_t offset, const uint8_t *bytes, int64_t length) {
  while (length > 0) {
    uv_buf_t chunk = uv_buf_init((char *)bytes, (unsigned int)lerta_io_chunk(length));
    uv_fs_t request;
    int64_t written = uv_fs_write(NULL, &request, file, &chunk, 1, offset, NULL);
    uv_fs_req_cleanup(&request);
    if (written <= 0) return false;
    bytes += written;
    length -= written;
    if (offset >= 0) offset += written;
  }
  return true;
}

bool lerta_os_write_file(const char *path, const uint8_t *bytes, int64_t length) {
  int flags = UV_FS_O_WRONLY | UV_FS_O_CREAT | UV_FS_O_TRUNC;
  uv_file file = open_file(path, flags, 0644);
  if (file < 0) return false;
  bool written = write_all(file, -1, bytes, length);
  close_file(file);
  return written;
}

int64_t lerta_os_open_for_writing(const char *path) {
  return open_file(path, UV_FS_O_WRONLY | UV_FS_O_CREAT | UV_FS_O_TRUNC, 0644);
}

bool lerta_os_write_at(int64_t file, int64_t offset, const uint8_t *bytes, int64_t length) {
  return write_all((uv_file)file, offset, bytes, length);
}

void lerta_os_close(int64_t file) { close_file((uv_file)file); }

// The libuv error of the stat, 0 if it succeeds, with what it found in `found`.
static int stat_path(const char *path, uv_stat_t *found) {
  uv_fs_t request;
  int error = uv_fs_stat(NULL, &request, path, NULL);
  if (error == 0) *found = request.statbuf;
  uv_fs_req_cleanup(&request);
  return error;
}

int lerta_os_stat(const char *path, LertaFileStatus *status) {
  uv_stat_t found;
  int error = stat_path(path, &found);
  if (error != 0) return error == UV_ENOENT || error == UV_ENOTDIR ? 0 : -1;
  status->kind = is_file_mode(found.st_mode)  ? LERTA_FILE_KIND
                 : is_dir_mode(found.st_mode) ? LERTA_DIR_KIND
                                              : LERTA_OTHER_KIND;
  status->size = (int64_t)found.st_size;
  status->modified_time = (int64_t)found.st_mtim.tv_sec * 1000000000 + found.st_mtim.tv_nsec;
  return 1;
}

char *lerta_os_current_dir(void) {
  size_t size = 256;
  char *buffer = lerta_checked_malloc(size);
  int error;
  // A buffer too small for it is given the size it needs, its terminating NUL included.
  while ((error = uv_cwd(buffer, &size)) == UV_ENOBUFS) {
    free(buffer);
    buffer = lerta_checked_malloc(size);
  }
  if (error == 0) return buffer;
  free(buffer);
  return NULL;
}

char *lerta_os_real_path(const char *path) {
  uv_fs_t request;
  bool resolved = uv_fs_realpath(NULL, &request, path, NULL) == 0;
  char *result = resolved ? strdup(request.ptr) : NULL;
  uv_fs_req_cleanup(&request);
  return result;
}

// The path of `name` in the directory `dir`, which the caller frees. A directory that ends with a
// separator, as the root does, takes no other.
static char *join_path(const char *dir, const char *name) {
  size_t dir_length = strlen(dir);
  size_t name_length = strlen(name);
  bool has_separator = dir_length > 0 && lerta_os_is_separator(dir[dir_length - 1]);
  char *path = lerta_checked_malloc(dir_length + name_length + 2);
  memcpy(path, dir, dir_length);
  if (!has_separator) path[dir_length++] = lerta_os_separator();
  memcpy(path + dir_length, name, name_length + 1);
  return path;
}

// The text that `get` writes, as libuv's functions that tell the size that they need, through
// `size`, with UV_ENOBUFS, write it; NULL if it fails otherwise. The caller frees it.
static char *sized_text(int (*get)(const void *context, char *buffer, size_t *size),
                        const void *context) {
  size_t size = 256;
  for (;;) {
    char *text = lerta_checked_malloc(size);
    int error = get(context, text, &size);
    if (error == 0) return text;
    free(text);
    if (error != UV_ENOBUFS) return NULL;
  }
}

static int get_temp_dir(const void *context, char *buffer, size_t *size) {
  (void)context;
  return uv_os_tmpdir(buffer, size);
}

static int get_env(const void *name, char *buffer, size_t *size) {
  return uv_os_getenv(name, buffer, size);
}

// On Windows, libuv reads a variable that is not valid UTF-16 as WTF-8, which it reads back as it
// was when it runs a program with it.
void lerta_os_environ(LertaArray *entries) {
  uv_env_item_t *items;
  int count;
  if (uv_os_environ(&items, &count) != 0) lerta_panic("out of memory");
  for (int i = 0; i < count; i++) {
    size_t name_length = strlen(items[i].name);
    size_t value_length = strlen(items[i].value);
    char *entry = lerta_checked_malloc(name_length + value_length + 2);
    memcpy(entry, items[i].name, name_length);
    entry[name_length] = '=';
    memcpy(entry + name_length + 1, items[i].value, value_length + 1);
    lerta_append_c_string(entries, entry);
    free(entry);
  }
  uv_os_free_environ(items, count);
}

int64_t lerta_os_process_id(void) {
  return uv_os_getpid();
}

// The path of `name` in the system's directory for temporary files, which the caller frees. libuv
// takes the first of TMPDIR, TMP, TEMP and TEMPDIR that is set on POSIX, even if it is empty, which
// is taken as unset, as most programs take it.
static char *temp_path(const char *name) {
  char *dir = sized_text(get_temp_dir, NULL);
  if (dir == NULL) return NULL;
  char *path = join_path(dir[0] == '\0' ? "/tmp" : dir, name);
  free(dir);
  return path;
}

char *lerta_os_make_temp_dir(void) {
  char *template = temp_path("lerta-XXXXXX");
  if (template == NULL) return NULL;
  uv_fs_t request;
  bool made = uv_fs_mkdtemp(NULL, &request, template, NULL) == 0;
  char *path = made ? strdup(request.path) : NULL;
  uv_fs_req_cleanup(&request);
  free(template);
  return path;
}

bool lerta_os_make_dir(const char *path) {
  uv_fs_t request;
  bool made = uv_fs_mkdir(NULL, &request, path, 0777, NULL) == 0;
  uv_fs_req_cleanup(&request);
  uv_stat_t found;
  return made || (stat_path(path, &found) == 0 && is_dir_mode(found.st_mode));
}

bool lerta_os_rename(const char *from, const char *to) {
  uv_fs_t request;
  bool renamed = uv_fs_rename(NULL, &request, from, to, NULL) == 0;
  uv_fs_req_cleanup(&request);
  return renamed;
}

// libuv lists the entries without `.` and `..`, and all at once, so they may be removed while
// they are read.
// A directory is listed by its real path: on Windows, a drive alone, as C:, names the drive's
// current directory, but libuv lists the drive's root for it.
bool lerta_os_list_dir(const char *path, LertaArray *names) {
  char *dir = lerta_os_real_path(path);
  if (dir == NULL) return false;
  uv_fs_t request;
  bool listed = uv_fs_scandir(NULL, &request, dir, 0, NULL) >= 0;
  uv_dirent_t entry;
  while (listed && uv_fs_scandir_next(&request, &entry) == 0) {
    lerta_append_c_string(names, entry.name);
  }
  uv_fs_req_cleanup(&request);
  free(dir);
  return listed;
}

// The entries are listed again until a listing finds none, as the directory may change while its
// entries are removed. Each is found again by its path, so a directory replaced by a link while
// the tree is removed is followed: it serves Windows, where only the owner of a tree may change it
// by default; POSIX systems remove one by descriptors (see platform_posix.c). It runs on a worker,
// so it keeps the names in libuv's listing, not in an array of the runtime's.
static bool remove_entries(const char *path) {
  for (;;) {
    uv_fs_t request;
    int64_t count = uv_fs_scandir(NULL, &request, path, 0, NULL);
    bool removed = count >= 0;
    uv_dirent_t entry;
    while (removed && uv_fs_scandir_next(&request, &entry) == 0) {
      char *child = join_path(path, entry.name);
      removed = lerta_remove_tree_by_paths(child);
      free(child);
    }
    uv_fs_req_cleanup(&request);
    if (!removed || count == 0) return removed;
  }
}

bool lerta_os_remove_file(const char *path) {
  uv_fs_t request;
  bool removed = uv_fs_unlink(NULL, &request, path, NULL) == 0;
  uv_fs_req_cleanup(&request);
  return removed;
}

bool lerta_remove_tree_by_paths(const char *path) {
  uv_fs_t request;
  int error = uv_fs_lstat(NULL, &request, path, NULL);
  bool is_dir = error == 0 && is_dir_mode(request.statbuf.st_mode);
  uv_fs_req_cleanup(&request);
  if (error != 0) return false;
  if (!is_dir) {
    bool unlinked = uv_fs_unlink(NULL, &request, path, NULL) == 0;
    uv_fs_req_cleanup(&request);
    return unlinked;
  }
  // By its real path, as lerta_os_list_dir lists a directory.
  char *dir = lerta_os_real_path(path);
  bool removed = dir != NULL && remove_entries(dir);
  if (removed) {
    removed = uv_fs_rmdir(NULL, &request, dir, NULL) == 0;
    uv_fs_req_cleanup(&request);
  }
  free(dir);
  return removed;
}

int64_t lerta_os_cpu_count(void) { return uv_available_parallelism(); }

double lerta_os_unix_time(void) {
  uv_timespec64_t now;
  uv_clock_gettime(UV_CLOCK_REALTIME, &now);
  return (double)now.tv_sec + (double)now.tv_nsec / 1e9;
}

char *lerta_os_env(const char *name) { return sized_text(get_env, name); }

void lerta_hash_init(void) {
  if (uv_random(NULL, NULL, &lerta_hash_seed, sizeof lerta_hash_seed, 0, NULL) != 0) {
    // Without the system's randomness, the time and an address that ASLR moves still differ by run.
    lerta_hash_seed = uv_hrtime() ^ (uint64_t)(uintptr_t)&lerta_hash_seed;
  }
}
