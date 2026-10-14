#ifndef _WIN32

#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <signal.h>
#include <spawn.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/resource.h>
#include <sys/stat.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

#include "internal.h"

// A stack overflow touches the guard page below the stack, which raises SIGSEGV (SIGBUS on some
// systems). The handler runs on a stack of its own, since the overflowed one has no room left.
static uint8_t handler_stack[1 << 16];
static uintptr_t stack_top = 0;
static uintptr_t stack_limit = 0;

// Without a limit, or with one beyond the address space, the stack has no known range, so no
// fault is taken for an overflow. The guard page lies just past the limit, so a little slack is
// allowed below it.
static bool is_stack_overflow(uintptr_t address) {
  uintptr_t slack = 1 << 16;
  if (stack_limit == RLIM_INFINITY || stack_limit > stack_top - slack) return false;
  return address >= stack_top - slack - stack_limit && address < stack_top;
}

static void on_fault(int signal_number, siginfo_t *info, void *context) {
  (void)context;
  if (is_stack_overflow((uintptr_t)info->si_addr)) lerta_panic("stack overflow");
  // Any other fault is not Lerta's to report: the default action ends the program when the
  // faulting instruction runs again.
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

bool lerta_os_write(int fd, const uint8_t *bytes, int64_t length) {
  while (length > 0) {
    ssize_t written = write(fd, bytes, (size_t)length);
    if (written < 0 && errno == EINTR) continue;
    if (written <= 0) return false;
    bytes += written;
    length -= written;
  }
  return true;
}

bool lerta_os_is_terminal(int fd) {
  return isatty(fd);
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
    ssize_t count = read((int)(intptr_t)file, buffer, (size_t)size);
    if (count >= 0 || errno != EINTR) return count < 0 ? -1 : count;
  }
}

LertaString *lerta_os_read_file(const char *path) {
  int fd = open(path, O_RDONLY);
  if (fd < 0) return NULL;
  LertaString *contents = lerta_read_chunks(read_fd, (void *)(intptr_t)fd);
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

bool lerta_os_is_file(const char *path) {
  struct stat status;
  return stat(path, &status) == 0 && S_ISREG(status.st_mode);
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

// Each level of nesting holds a directory open, so a tree deeper than the limit on open files fails.
bool lerta_os_remove_tree(const char *path) {
  struct stat status;
  if (lstat(path, &status) != 0) return false;
  if (!S_ISDIR(status.st_mode)) return unlink(path) == 0;
  return remove_entries(path) && rmdir(path) == 0;
}

extern char **environ;

// Shells report a child killed by a signal as 128 plus the signal number, so callers can tell it
// from an exit code.
static int64_t exit_code_of(int status) {
  return WIFSIGNALED(status) ? 128 + WTERMSIG(status) : WEXITSTATUS(status);
}

static bool spawn(char **args, const posix_spawn_file_actions_t *actions, pid_t *pid) {
  return posix_spawnp(pid, args[0], actions, NULL, args, environ) == 0;
}

// The child writes its standard output to a pipe, which is read here until the child closes it.
static bool spawn_reading_output(char **args, LertaString **output, pid_t *pid) {
  int pipe_fds[2];
  if (pipe(pipe_fds) != 0) return false;
  posix_spawn_file_actions_t actions;
  posix_spawn_file_actions_init(&actions);
  posix_spawn_file_actions_adddup2(&actions, pipe_fds[1], STDOUT_FILENO);
  // A program started with stdout closed may get fd 1 as an end of the pipe, which the child must
  // keep as its stdout.
  for (int i = 0; i < 2; i++) {
    if (pipe_fds[i] != STDOUT_FILENO) posix_spawn_file_actions_addclose(&actions, pipe_fds[i]);
  }
  bool spawned = spawn(args, &actions, pid);
  posix_spawn_file_actions_destroy(&actions);
  close(pipe_fds[1]);
  if (spawned) *output = lerta_read_chunks(read_fd, (void *)(intptr_t)pipe_fds[0]);
  close(pipe_fds[0]);
  return spawned;
}

bool lerta_os_run(char **args, LertaString **output, int64_t *exit_code) {
  pid_t pid;
  bool spawned = output == NULL ? spawn(args, NULL, &pid) : spawn_reading_output(args, output, &pid);
  if (!spawned) return false;
  int status;
  while (waitpid(pid, &status, 0) < 0) {
    if (errno != EINTR) lerta_panic("cannot wait for a child process");
  }
  *exit_code = exit_code_of(status);
  return true;
}

#endif
