// Reads "hi" from stdin, made non-blocking, where the input comes later, so that the read finds the
// pipe empty first.
#include <fcntl.h>
#include <unistd.h>
#include "internal.h"

void lerta_main(void) {
  uint8_t bytes[16];
  fcntl(0, F_SETFL, fcntl(0, F_GETFL) | O_NONBLOCK);
  int64_t count = lerta_os_read_stdin(bytes, sizeof bytes);
  _exit(count == 2 && bytes[0] == 'h' && bytes[1] == 'i' ? 0 : 1);
}
