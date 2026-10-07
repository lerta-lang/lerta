#include "lerta.h"

// Entry point of every Lerta program: the compiler emits the module's
// top-level code as lerta_main, and the runtime wraps it with setup and exit.
void lerta_main(void);

int main(void) {
  lerta_main();
  return lerta_stdout_flush() ? 0 : 1;
}
