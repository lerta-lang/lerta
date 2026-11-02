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
#include <sys/utsname.h>
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

// SIGPIPE is ignored, so that a write to a socket fails rather than ends the program, as libuv's
// writes do not keep it from doing on Linux; a write here ends it as the signal did. The programs
// that run starts take the default again, as libuv resets each signal.
static void end_by_broken_pipe(void) {
  signal(SIGPIPE, SIG_DFL);
  raise(SIGPIPE);
}

bool lerta_os_write(int fd, const uint8_t *bytes, int64_t length) {
  while (length > 0) {
    ssize_t written = write(fd, bytes, (size_t)lerta_io_chunk(length));
    if (written < 0 && errno == EINTR) continue;
    if (written < 0 && errno == EPIPE) end_by_broken_pipe();
    bool is_full = written < 0 && (errno == EAGAIN || errno == EWOULDBLOCK);
    if (is_full && wait_ready(fd, POLLOUT)) continue;
    if (written <= 0) return false;
    bytes += written;
    length -= written;
  }
  return true;
}

// A closed stdin, stdout or stderr is opened on /dev/null, which takes the lowest free descriptor,
// before libuv, a pipe or a socket takes it: one would otherwise be read as stdin, or be written
// by print and inherited by the programs that run starts. Read-only, a closed stdin reads as empty
// and a write to a closed stdout or stderr still fails. If even that fails, no standard stream is
// safe to use, so the program stops.
void lerta_os_stdio_init(void) {
  signal(SIGPIPE, SIG_IGN);
  for (int fd = STDIN_FILENO; fd <= STDERR_FILENO; fd++) {
    bool closed = fcntl(fd, F_GETFD) == -1 && errno == EBADF;
    if (closed && open("/dev/null", O_RDONLY) != fd) lerta_panic("cannot open /dev/null");
  }
}

void lerta_os_exit(int code) {
  _exit(code);
}

void lerta_os_abort(void) {
  abort();
}

static int64_t read_fd(void *file, uint8_t *buffer, int64_t size) {
  for (;;) {
    ssize_t count = read((int)(intptr_t)file, buffer, (size_t)lerta_io_chunk(size));
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

bool lerta_os_make_link(const char *target, const char *path) {
  return symlink(target, path) == 0;
}

// Gives the file `out` the permissions that both `own` and `from` have. A change only, which takes
// owning the file, so that one that the user may write but does not own is replaced as it is.
static bool narrow_mode(int out, mode_t own, mode_t from) {
  mode_t narrowed = own & from & 0777;
  return narrowed == (own & 07777) || fchmod(out, narrowed) == 0;
}

// A new copy takes the permissions of the file less the umask, without the setuid, setgid and
// sticky bits, which would make a copy of an attacker's file into a trusted place run as root; a
// file that the copy replaces keeps those of its own that the file has, so that a private file is
// not copied into one that others read. Both files are opened without waiting, so that a FIFO
// with nothing at its other end fails rather than blocks, and the destination is checked before it
// is changed, so that a copy found wrong before it starts, as one onto the file itself, through a
// link too, which would empty it, leaves it as it was.
bool lerta_os_copy_file(const char *from, const char *to) {
  int in = open(from, O_RDONLY | O_NONBLOCK | O_CLOEXEC);
  if (in < 0) return false;
  struct stat found;
  bool is_file = fstat(in, &found) == 0 && S_ISREG(found.st_mode);
  int flags = O_WRONLY | O_CREAT | O_NONBLOCK | O_CLOEXEC;
  int out = is_file ? open(to, flags, found.st_mode & 0777) : -1;
  struct stat existing;
  bool is_other_file = out >= 0 && fstat(out, &existing) == 0 && S_ISREG(existing.st_mode) &&
                       (existing.st_dev != found.st_dev || existing.st_ino != found.st_ino);
  bool copied = is_other_file && narrow_mode(out, existing.st_mode, found.st_mode) &&
                ftruncate(out, 0) == 0;
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

bool lerta_os_same_env_name(const char *a, const char *b) {
  return strcmp(a, b) == 0;
}

bool lerta_os_is_separator(char c) {
  return c == '/';
}

char lerta_os_separator(void) { return '/'; }

const char *lerta_os_platform(void) {
  struct utsname name;
  if (uname(&name) != 0) lerta_panic("cannot read the system's name");
  return strcmp(name.sysname, "Darwin") == 0 ? "macos" : "linux";
}

extern char **environ;

void lerta_os_environ(LertaArray *entries) {
  for (char **entry = environ; *entry != NULL; entry++) lerta_append_c_string(entries, *entry);
}

int64_t lerta_os_process_id(void) {
  return getpid();
}

// Signal 0 only checks the process.
bool lerta_os_is_running(int id) {
  return kill(id, 0) == 0 || errno != ESRCH;
}

// The system searches PATH when it runs the program.
char *lerta_os_program_file(const char *command) {
  return strdup(command);
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

void lerta_os_discard_region(void *region, int64_t size) {
#ifdef MADV_FREE
  madvise(region, (size_t)size, MADV_FREE);
#else
  madvise(region, (size_t)size, MADV_DONTNEED);
#endif
}

// A count of names, and a block of them, each ended with a NUL; NULL for none.
typedef struct {
  size_t count;
  char *names;
} Names;

static bool append_name(Names *names, size_t *size, size_t *capacity, const char *name) {
  size_t length = strlen(name) + 1;
  if (*size + length > *capacity) {
    size_t grown = (*size + length) * 2;
    char *names_grown = realloc(names->names, grown);
    if (names_grown == NULL) return false;
    names->names = names_grown;
    *capacity = grown;
  }
  memcpy(names->names + *size, name, length);
  *size += length;
  names->count++;
  return true;
}

// The names in the directory open at `dir` but `.` and `..`, read at once so that no descriptor
// stays open for it while its entries are removed; false on failure. It runs on a worker, so it
// takes memory from malloc and fails rather than panics without it.
static bool list_names(int dir, Names *names) {
  *names = (Names){ 0, NULL };
  int copy = dup(dir);
  DIR *listing = copy >= 0 ? fdopendir(copy) : NULL;
  if (listing == NULL) {
    if (copy >= 0) close(copy);
    return false;
  }
  // The copy shares its offset with `dir`, which an earlier listing left at the end.
  rewinddir(listing);
  size_t size = 0;
  size_t capacity = 0;
  bool listed = true;
  for (;;) {
    errno = 0;
    struct dirent *entry = readdir(listing);
    if (entry == NULL) {
      listed = errno == 0;
      break;
    }
    if (strcmp(entry->d_name, ".") == 0 || strcmp(entry->d_name, "..") == 0) continue;
    listed = append_name(names, &size, &capacity, entry->d_name);
    if (!listed) break;
  }
  closedir(listing);
  if (!listed) free(names->names);
  return listed;
}

static bool same_file(const struct stat *a, const struct stat *b) {
  return a->st_dev == b->st_dev && a->st_ino == b->st_ino;
}

// Whether `name` in the directory open at `dir` is still the file found, rather than one put there
// meanwhile.
static bool is_named(int dir, const char *name, const struct stat *file) {
  struct stat found;
  return fstatat(dir, name, &found, AT_SYMLINK_NOFOLLOW) == 0 && same_file(&found, file);
}

// The parent of a tree is opened only to find its entries in, which takes no permission to read
// it, as removing one by its path takes none: a directory that others may only write and search,
// as a drop box, holds trees that can be removed.
#if defined(O_SEARCH)
#define SEARCH_ONLY O_SEARCH
#elif defined(O_PATH)
#define SEARCH_ONLY O_PATH
#else
#define SEARCH_ONLY O_RDONLY
#endif

// The directory that holds the one open at `child`, opened to be read, as one whose entries are
// removed is, or else, as the parent of the tree, to be searched alone.
static int open_parent(int child) {
  int parent = openat(child, "..", O_RDONLY | O_DIRECTORY | O_CLOEXEC);
  if (parent >= 0 || errno != EACCES) return parent;
  return openat(child, "..", SEARCH_ONLY | O_DIRECTORY | O_CLOEXEC);
}

// A directory that the walk is in: the names left to remove in it, the one of the directory below
// that the walk went into, and what it was found to be, which its `..` must still be once that one
// is empty. The walk keeps one per level on the heap, as no depth must overflow a worker's stack.
typedef struct {
  Names names;
  const char *next;
  size_t left;
  const char *below;
  struct stat found;
  // The directory that holds the tree, of which it has the tree's name alone, not listed again.
  bool is_holder;
} Level;

typedef struct {
  Level *levels;
  size_t count;
  size_t capacity;
} Walk;

// Adds the level of the directory open at `dir`, whose names it takes, to free with it.
static bool enter_level(Walk *walk, int dir, Names names, bool is_holder) {
  if (walk->count == walk->capacity) {
    size_t capacity = walk->capacity == 0 ? 16 : walk->capacity * 2;
    Level *levels = realloc(walk->levels, capacity * sizeof *levels);
    if (levels == NULL) {
      free(names.names);
      return false;
    }
    walk->levels = levels;
    walk->capacity = capacity;
  }
  Level *level = &walk->levels[walk->count];
  *level = (Level){ names, names.names, names.count, NULL, { 0 }, is_holder };
  walk->count++;
  return fstat(dir, &level->found) == 0;
}

// Removes the entry `name` of the directory open at `*dir`: a file at once, and a directory by
// going into it, which leaves it alone open.
static bool remove_entry(Walk *walk, int *dir, const char *name) {
  struct stat found;
  if (fstatat(*dir, name, &found, AT_SYMLINK_NOFOLLOW) != 0) return false;
  if (!S_ISDIR(found.st_mode)) return unlinkat(*dir, name, 0) == 0;
  int child = openat(*dir, name, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  if (child < 0) return false;
  Names names;
  if (!list_names(child, &names)) {
    close(child);
    return false;
  }
  walk->levels[walk->count - 1].below = name;
  close(*dir);
  *dir = child;
  return enter_level(walk, child, names, false);
}

// Leaves the directory open at `*dir`, which is empty, for the one above, which must be the one it
// was entered from, and removes it there.
static bool leave_level(Walk *walk, int *dir) {
  Level *emptied = &walk->levels[walk->count - 1];
  struct stat found_emptied = emptied->found;
  free(emptied->names.names);
  walk->count--;
  Level *above = &walk->levels[walk->count - 1];
  int back = open_parent(*dir);
  close(*dir);
  *dir = back;
  struct stat found;
  return back >= 0 && fstat(back, &found) == 0 && same_file(&found, &above->found) &&
         is_named(back, above->below, &found_emptied) &&
         unlinkat(back, above->below, AT_REMOVEDIR) == 0;
}

// Removes the file or the tree `name` in the directory open at `*dir`, by descriptors, so that a
// directory replaced by a link after it is found fails to open rather than be followed to remove
// what the link names, as it could be in a directory that others write, such as a shared temporary
// one. The walk keeps the directory it is in alone open, and goes back up by `..`. The entries of a
// directory are listed again until a listing finds none, as it may change while they are removed.
// `*dir` is opened again, as another directory, or closed, where it fails.
static bool remove_at(int *dir, const char *name) {
  Names holder = { 1, strdup(name) };
  if (holder.names == NULL) return false;
  Walk walk = { NULL, 0, 0 };
  bool removed = enter_level(&walk, *dir, holder, true);
  while (removed) {
    Level *level = &walk.levels[walk.count - 1];
    if (level->left > 0) {
      const char *entry = level->next;
      level->next += strlen(entry) + 1;
      level->left--;
      removed = remove_entry(&walk, dir, entry);
    } else if (level->is_holder) {
      break;
    } else {
      free(level->names.names);
      level->names = (Names){ 0, NULL };
      removed = list_names(*dir, &level->names);
      level->next = level->names.names;
      level->left = level->names.count;
      if (removed && level->left == 0) removed = leave_level(&walk, dir);
    }
  }
  for (size_t i = 0; i < walk.count; i++) free(walk.levels[i].names.names);
  free(walk.levels);
  return removed;
}

// Whether `name` in the directory open at `dir` is a directory or a link, which alone a path may
// name with a slash after it.
static bool names_dir_or_link(int dir, const char *name) {
  struct stat found;
  return fstatat(dir, name, &found, AT_SYMLINK_NOFOLLOW) == 0 &&
         (S_ISDIR(found.st_mode) || S_ISLNK(found.st_mode));
}

// The links on the way to the path are followed, as its last part alone is the tree, removed in
// the directory that holds it as its entries are; slashes at its end are left out, as they would
// have that part followed too.
bool lerta_os_remove_tree(const char *path) {
  size_t length = strlen(path);
  while (length > 1 && path[length - 1] == '/') length--;
  char *trimmed = strndup(path, length);
  if (trimmed == NULL) return false;
  char *slash = strrchr(trimmed, '/');
  // The slash stays with the directory, so that `/` names the root.
  char *dir_path = slash == NULL ? strdup(".") : strndup(trimmed, (size_t)(slash - trimmed) + 1);
  const char *name = slash == NULL ? trimmed : slash + 1;
  int parent = dir_path == NULL ? -1 : open(dir_path, SEARCH_ONLY | O_DIRECTORY | O_CLOEXEC);
  bool slashed = length < strlen(path);
  bool removed = parent >= 0 && (!slashed || names_dir_or_link(parent, name)) &&
                 remove_at(&parent, name);
  if (parent >= 0) close(parent);
  free(dir_path);
  free(trimmed);
  return removed;
}
