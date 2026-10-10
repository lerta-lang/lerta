#include "lerta.h"

// Entry point of every Lerta program: the compiler emits the module's
// top-level code as lerta_main, and the runtime wraps it with setup and exit.
void lerta_main(void);

LertaException lerta_exception = {NULL, NULL};

int main(int argc, char **argv) {
  lerta_stack_init();
  lerta_set_arguments(argc, argv);
  lerta_stdout_init();
  lerta_main();
  if (lerta_exception.data != NULL) {
    LertaString *(*message)(void *error) = (LertaString * (*)(void *)) lerta_exception.itab[0];
    lerta_throw(message(lerta_exception.data));
  }
  bool flushed = lerta_stdout_flush();
  bool leak_free = lerta_check_leaks();
  return flushed && leak_free ? 0 : 1;
}
