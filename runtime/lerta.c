#include "lerta.h"

// Entry point of every Lerta program: the compiler emits the module's
// top-level code as lerta_main, and the runtime wraps it with setup and exit.
void lerta_main(void);

int main(int argc, char **argv) {
  lerta_set_arguments(argc, argv);
  lerta_main();
  bool flushed = lerta_stdout_flush();
  bool leak_free = lerta_check_leaks();
  return flushed && leak_free ? 0 : 1;
}
