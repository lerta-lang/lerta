#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <uv.h>

#include "internal.h"

// The platform functions that libuv makes the same on every system, through its synchronous file
// system calls, which take no loop and no callback (see docs/internals.md#platforms).

// Each read or write asks for 1 GiB at most, as macOS rejects one of more than INT_MAX bytes and
// libuv's buffers count their bytes in an unsigned int on Windows.
static unsigned int request_size(int64_t length) {
  return length > (1 << 30) ? 1u << 30 : (unsigned int)length;
}

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

static int64_t read_file(void *file, uint8_t *buffer, int64_t size) {
  uv_buf_t chunk = uv_buf_init((char *)buffer, request_size(size));
  uv_fs_t request;
  int64_t count = uv_fs_read(NULL, &request, (uv_file)(intptr_t)file, &chunk, 1, -1, NULL);
  uv_fs_req_cleanup(&request);
  return count < 0 ? -1 : count;
}

uint8_t *lerta_os_read_file(const char *path, int64_t *length) {
  uv_file file = open_file(path, UV_FS_O_RDONLY, 0);
  if (file < 0) return NULL;
  uint8_t *contents = lerta_read_chunks(read_file, (void *)(intptr_t)file, length);
  close_file(file);
  return contents;
}

static bool write_all(uv_file file, const uint8_t *bytes, int64_t length) {
  while (length > 0) {
    uv_buf_t chunk = uv_buf_init((char *)bytes, request_size(length));
    uv_fs_t request;
    int64_t written = uv_fs_write(NULL, &request, file, &chunk, 1, -1, NULL);
    uv_fs_req_cleanup(&request);
    if (written <= 0) return false;
    bytes += written;
    length -= written;
  }
  return true;
}

bool lerta_os_write_file(const char *path, const uint8_t *bytes, int64_t length) {
  int flags = UV_FS_O_WRONLY | UV_FS_O_CREAT | UV_FS_O_TRUNC;
  uv_file file = open_file(path, flags, 0644);
  if (file < 0) return false;
  bool written = write_all(file, bytes, length);
  close_file(file);
  return written;
}

// The libuv error of the stat, 0 if it succeeds, with what it found in `found`.
static int stat_path(const char *path, uv_stat_t *found) {
  uv_fs_t request;
  int error = uv_fs_stat(NULL, &request, path, NULL);
  if (error == 0) *found = request.statbuf;
  uv_fs_req_cleanup(&request);
  return error;
}

static bool is_file_mode(uint64_t mode) { return (mode & S_IFMT) == S_IFREG; }

static bool is_dir_mode(uint64_t mode) { return (mode & S_IFMT) == S_IFDIR; }

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

// The path of `name` in the system's directory for temporary files, which the caller frees. libuv
// takes the first of TMPDIR, TMP, TEMP and TEMPDIR that is set on POSIX, even if it is empty, which
// is taken as unset, as most programs take it.
static char *temp_path(const char *name) {
  size_t size = 256;
  for (;;) {
    char *dir = lerta_checked_malloc(size);
    int error = uv_os_tmpdir(dir, &size);
    char *path = error != 0 ? NULL : join_path(dir[0] == '\0' ? "/tmp" : dir, name);
    free(dir);
    // `size` is now the size that the directory needs.
    if (error != UV_ENOBUFS) return path;
  }
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
// A directory is listed by its real path: on Windows, a drive alone, as C:, names the drive's current
// directory, but libuv lists the drive's root for it.
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
// entries are removed. It runs on a worker, so it keeps the names in libuv's listing, not in an
// array of the runtime's.
static bool remove_entries(const char *path) {
  for (;;) {
    uv_fs_t request;
    int64_t count = uv_fs_scandir(NULL, &request, path, 0, NULL);
    bool removed = count >= 0;
    uv_dirent_t entry;
    while (removed && uv_fs_scandir_next(&request, &entry) == 0) {
      char *child = join_path(path, entry.name);
      removed = lerta_os_remove_tree(child);
      free(child);
    }
    uv_fs_req_cleanup(&request);
    if (!removed || count == 0) return removed;
  }
}

bool lerta_os_remove_tree(const char *path) {
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

char *lerta_os_env(const char *name) {
  size_t size = 256;
  for (;;) {
    char *value = lerta_checked_malloc(size);
    int error = uv_os_getenv(name, value, &size);
    if (error == 0) return value;
    free(value);
    // `size` is now the size that the value needs.
    if (error != UV_ENOBUFS) return NULL;
  }
}
