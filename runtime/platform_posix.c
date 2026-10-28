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

// SIGPIPE is ignored, so that a write to a socket fails rather than ends the program, as libuv's
// writes do not keep it from doing on Linux; a write here ends it as the signal did. The programs
// that run starts take the default again, as libuv resets each signal.
static void end_by_broken_pipe(void) {
  signal(SIGPIPE, SIG_DFL);
  raise(SIGPIPE);
}

bool lerta_os_write(int fd, const uint8_t *bytes, int64_t length) {
  while (length > 0) {
    ssize_t written = write(fd, bytes, request_size(length));
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
