#ifndef _WIN32

#include <errno.h>
#include <fcntl.h>
#include <signal.h>
#include <spawn.h>
#include <stdlib.h>
#include <sys/resource.h>
#include <sys/stat.h>
#include <sys/wait.h>
#include <unistd.h>

#include "lerta.h"

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

extern char **environ;

// Shells report a child killed by a signal as 128 plus the signal number, so callers can tell it
// from an exit code.
static int64_t exit_code_of(int status) {
  return WIFSIGNALED(status) ? 128 + WTERMSIG(status) : WEXITSTATUS(status);
}

bool lerta_os_run(char **args, int64_t *exit_code) {
  pid_t pid;
  if (posix_spawnp(&pid, args[0], NULL, NULL, args, environ) != 0) return false;
  int status;
  while (waitpid(pid, &status, 0) < 0) {
    if (errno != EINTR) lerta_panic("cannot wait for a child process");
  }
  *exit_code = exit_code_of(status);
  return true;
}

#endif
