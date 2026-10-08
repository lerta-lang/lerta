#include <signal.h>
#include <stdint.h>
#include <sys/resource.h>

#include "lerta.h"

// A stack overflow touches the guard page below the stack, which raises SIGSEGV (SIGBUS on some
// systems). The handler runs on a stack of its own, since the overflowed one has no room left.
// Windows will need the same with a vectored exception handler (see docs/internals.md).
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
