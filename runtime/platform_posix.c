#ifndef _WIN32

#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <poll.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mman.h>
#include <sys/resource.h>
#include <sys/stat.h>
#include <time.h>
#include <unistd.h>

#include "internal.h"

static uint8_t handler_stack[1 << 16];
static uintptr_t stack_top = 0;
static uintptr_t stack_limit = 0;

static bool is_stack_overflow(uintptr_t address) {
  // The guard page lies just past the limit, so a little slack is allowed below it.
  uintptr_t slack = 1 << 16;
  if (stack_limit == RLIM_INFINITY || stack_limit > stack_top - slack) return false;
  return address >= stack_top - slack - stack_limit && address < stack_top;
}

static void on_fault(int signal_number, siginfo_t *info, void *context) {
  (void)context;
  if (is_stack_overflow((uintptr_t)info->si_addr)) lerta_panic("stack overflow");
  signal(signal_number, SIG_DFL);
}

void lerta_stack_init(void) {
  stack_top = (uintptr_t)__builtin_frame_address(0);
  struct rlimit limit;
  stack_limit = getrlimit(RLIMIT_STACK, &limit) == 0 ? (uintptr_t)limit.rlim_cur : RLIM_INFINITY;
  stack_t handler = { .ss_sp = handler_stack, .ss_size = sizeof handler_stack, .ss_flags = 0 };
  sigaltstack(&handler, NULL);
  struct sigaction action = { .sa_sigaction = on_fault, .sa_flags = SA_SIGINFO | SA_ONSTACK };
  sigemptyset(&action.sa_mask);
  sigaction(SIGSEGV, &action, NULL);
  sigaction(SIGBUS, &action, NULL);
}

void lerta_os_arguments(int *argc, char ***argv) {
  (void)argc;
  (void)argv;
}

// macOS rejects a read or a write of more than INT_MAX bytes, so each asks for 1 GiB at most, as
// on Windows.
static size_t request_size(int64_t length) {
  return length > (1 << 30) ? (size_t)1 << 30 : (size_t)length;
}

// A non-blocking fd, such as the pipe that Node.js gives a child for its stdout, takes nothing
// while it is full, and gives nothing while it is empty, so a write or a read waits for it as a
// blocking one would, for `events`, POLLOUT or POLLIN.
static bool wait_ready(int fd, short events) {
  struct pollfd ready_fd = { .fd = fd, .events = events };
  for (;;) {
    int ready = poll(&ready_fd, 1, -1);
    if (ready >= 0 || errno != EINTR) return ready > 0;
  }
}

bool lerta_os_write(int fd, const uint8_t *bytes, int64_t length) {
  while (length > 0) {
    ssize_t written = write(fd, bytes, request_size(length));
    if (written < 0 && errno == EINTR) continue;
    bool is_full = written < 0 && (errno == EAGAIN || errno == EWOULDBLOCK);
    if (is_full && wait_ready(fd, POLLOUT)) continue;
    if (written <= 0) return false;
    bytes += written;
    length -= written;
  }
  return true;
}

// A closed stdin is opened on /dev/null, which takes the lowest free descriptor, 0, before libuv
// opens descriptors of its own, which would otherwise take 0 and be read as stdin. If even that
// fails, no stdin is safe to read, so the program stops.
void lerta_os_stdio_init(void) {
  signal(SIGPIPE, SIG_DFL);
  bool closed = fcntl(STDIN_FILENO, F_GETFD) == -1 && errno == EBADF;
  if (closed && open("/dev/null", O_RDONLY) != STDIN_FILENO) lerta_panic("cannot open /dev/null");
}

double lerta_os_unix_time(void) {
  struct timespec now;
  clock_gettime(CLOCK_REALTIME, &now);
  return (double)now.tv_sec + (double)now.tv_nsec / 1e9;
}

void lerta_os_exit(int code) {
  _exit(code);
}

void lerta_os_abort(void) {
  abort();
}

static int64_t read_fd(void *file, uint8_t *buffer, int64_t size) {
  for (;;) {
    ssize_t count = read((int)(intptr_t)file, buffer, request_size(size));
    if (count >= 0 || errno != EINTR) return count < 0 ? -1 : count;
  }
}

int64_t lerta_os_read_stdin(uint8_t *buffer, int64_t size) {
  for (;;) {
    int64_t count = read_fd((void *)(intptr_t)STDIN_FILENO, buffer, size);
    bool is_empty = count < 0 && (errno == EAGAIN || errno == EWOULDBLOCK);
    if (!is_empty || !wait_ready(STDIN_FILENO, POLLIN)) return count;
  }
}

uint8_t *lerta_os_read_file(const char *path, int64_t *length) {
  int fd = open(path, O_RDONLY);
  if (fd < 0) return NULL;
  uint8_t *contents = lerta_read_chunks(read_fd, (void *)(intptr_t)fd, length);
  close(fd);
  return contents;
}

bool lerta_os_write_file(const char *path, const uint8_t *bytes, int64_t length) {
  int fd = open(path, O_WRONLY | O_CREAT | O_TRUNC, 0644);
  if (fd < 0) return false;
  bool written = lerta_os_write(fd, bytes, length);
  close(fd);
  return written;
}

int lerta_os_stat(const char *path, LertaFileStatus *status) {
  struct stat found;
  if (stat(path, &found) != 0) return errno == ENOENT || errno == ENOTDIR ? 0 : -1;
  status->kind = S_ISREG(found.st_mode)   ? LERTA_FILE_KIND
                 : S_ISDIR(found.st_mode) ? LERTA_DIR_KIND
                                          : LERTA_OTHER_KIND;
  status->size = found.st_size;
#ifdef __APPLE__
  struct timespec modified = found.st_mtimespec;
#else
  struct timespec modified = found.st_mtim;
#endif
  status->modified_time = (int64_t)modified.tv_sec * 1000000000 + modified.tv_nsec;
  return 1;
}

bool lerta_os_make_link(const char *target, const char *path) {
  return symlink(target, path) == 0;
}

// The copy takes the permissions of the file, as CopyFileW takes its attributes on Windows. Both
// files are opened without waiting, so that a FIFO with nothing at its other end fails rather than
// blocks, and the destination is checked before it is changed, so that a copy found wrong before it
// starts, as one onto the file itself, through a link too, which would empty it, leaves it as it was.
bool lerta_os_copy_file(const char *from, const char *to) {
  int in = open(from, O_RDONLY | O_NONBLOCK);
  if (in < 0) return false;
  struct stat found;
  bool is_file = fstat(in, &found) == 0 && S_ISREG(found.st_mode);
  int out = is_file ? open(to, O_WRONLY | O_CREAT | O_NONBLOCK, 0600) : -1;
  struct stat existing;
  bool is_other_file = out >= 0 && fstat(out, &existing) == 0 && S_ISREG(existing.st_mode) &&
                       (existing.st_dev != found.st_dev || existing.st_ino != found.st_ino);
  bool copied =
    is_other_file && fchmod(out, found.st_mode & 07777) == 0 && ftruncate(out, 0) == 0;
  uint8_t buffer[65536];
  while (copied) {
    ssize_t count = read(in, buffer, sizeof buffer);
    if (count == 0) break;
    if (count < 0) copied = errno == EINTR;
    else copied = lerta_os_write(out, buffer, count);
  }
  if (out >= 0 && close(out) != 0) copied = false;
  close(in);
  return copied;
}

char *lerta_os_real_path(const char *path) {
  return realpath(path, NULL);
}

// The path of `name` in the directory `dir`, which the caller frees.
static char *join_path(const char *dir, const char *name) {
  size_t dir_length = strlen(dir);
  size_t name_length = strlen(name);
  char *path = lerta_checked_malloc(dir_length + name_length + 2);
  memcpy(path, dir, dir_length);
  path[dir_length] = '/';
  memcpy(path + dir_length + 1, name, name_length + 1);
  return path;
}

char *lerta_os_make_temp_dir(void) {
  const char *dir = getenv("TMPDIR");
  char *path = join_path(dir == NULL || *dir == '\0' ? "/tmp" : dir, "lerta-XXXXXX");
  if (mkdtemp(path) != NULL) return path;
  free(path);
  return NULL;
}

// The file is removed at once, so that it is gone however the programs end, and is not inherited
// by a program but where it is passed.
int lerta_os_input_file(const uint8_t *bytes, int64_t length) {
  const char *dir = getenv("TMPDIR");
  char *path = join_path(dir == NULL || *dir == '\0' ? "/tmp" : dir, "lerta-input-XXXXXX");
  int fd = mkstemp(path);
  if (fd >= 0) unlink(path);
  free(path);
  if (fd < 0) return -1;
  bool written = fcntl(fd, F_SETFD, FD_CLOEXEC) == 0 && lerta_os_write(fd, bytes, length);
  if (written && lseek(fd, 0, SEEK_SET) == 0) return fd;
  close(fd);
  return -1;
}

void lerta_os_close_input_file(int fd) {
  close(fd);
}

bool lerta_os_same_env_name(const char *a, const char *b) {
  return strcmp(a, b) == 0;
}

bool lerta_os_make_dir(const char *path) {
  struct stat status;
  return mkdir(path, 0777) == 0 || (stat(path, &status) == 0 && S_ISDIR(status.st_mode));
}

bool lerta_os_is_separator(char c) {
  return c == '/';
}

bool lerta_os_rename(const char *from, const char *to) {
  return rename(from, to) == 0;
}

int64_t lerta_os_cpu_count(void) {
  long count = sysconf(_SC_NPROCESSORS_ONLN);
  return count > 0 ? count : 1;
}

const char *lerta_os_platform(void) {
#ifdef __APPLE__
  return "macos";
#else
  return "linux";
#endif
}

char *lerta_os_env(const char *name) {
  const char *value = getenv(name);
  return value == NULL ? NULL : strdup(value);
}

static bool is_dot_or_dot_dot(const char *name) {
  return strcmp(name, ".") == 0 || strcmp(name, "..") == 0;
}

// readdir tells its end from a failure only by errno, which appending may change.
bool lerta_os_list_dir(const char *path, LertaArray *names) {
  DIR *dir = opendir(path);
  if (dir == NULL) return false;
  for (;;) {
    errno = 0;
    struct dirent *entry = readdir(dir);
    if (entry == NULL) break;
    if (!is_dot_or_dot_dot(entry->d_name)) lerta_append_c_string(names, entry->d_name);
  }
  bool listed = errno == 0;
  closedir(dir);
  return listed;
}

// readdir may miss entries when the directory changes while it is read, so the directory is read
// again until a reading finds nothing to remove.
static bool remove_entries(const char *path) {
  DIR *dir = opendir(path);
  if (dir == NULL) return false;
  bool removed = true;
  bool found = true;
  while (removed && found) {
    found = false;
    rewinddir(dir);
    struct dirent *entry;
    while (removed && (entry = readdir(dir)) != NULL) {
      if (is_dot_or_dot_dot(entry->d_name)) continue;
      found = true;
      char *child = join_path(path, entry->d_name);
      removed = lerta_os_remove_tree(child);
      free(child);
    }
  }
  closedir(dir);
  return removed;
}

bool lerta_os_remove_tree(const char *path) {
  struct stat status;
  if (lstat(path, &status) != 0) return false;
  if (!S_ISDIR(status.st_mode)) return unlink(path) == 0;
  return remove_entries(path) && rmdir(path) == 0;
}

// The system searches PATH when it runs the program.
char *lerta_os_program_file(const char *command) {
  return strdup(command);
}

char *lerta_os_program_argument(const char *argument) {
  return strdup(argument);
}

void *lerta_os_map_region(int64_t size) {
  if ((uint64_t)size > SIZE_MAX - LERTA_REGION_SIZE) return NULL;
  size_t mapped_size = (size_t)(size + LERTA_REGION_SIZE);
  uint8_t *mapped =
      mmap(NULL, mapped_size, PROT_READ | PROT_WRITE, MAP_PRIVATE | MAP_ANONYMOUS, -1, 0);
  if (mapped == MAP_FAILED) return NULL;
  uintptr_t mask = (uintptr_t)LERTA_REGION_SIZE - 1;
  uint8_t *region = (uint8_t *)(((uintptr_t)mapped + mask) & ~mask);
  size_t before = (size_t)(region - mapped);
  if (before > 0) munmap(mapped, before);
  size_t after = mapped_size - before - (size_t)size;
  if (after > 0) munmap(region + size, after);
  return region;
}

void lerta_os_unmap_region(void *region, int64_t size) { munmap(region, (size_t)size); }

#endif
