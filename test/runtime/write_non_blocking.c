// Writes 1 MiB to stdout, made non-blocking: more than a pipe holds, so that the write finds the
// pipe full.
#include <fcntl.h>
#include <string.h>
#include <unistd.h>
#include "internal.h"

void lerta_main(void) {
  static uint8_t bytes[1 << 20];
  memset(bytes, 'x', sizeof bytes);
  fcntl(1, F_SETFL, fcntl(1, F_GETFL) | O_NONBLOCK);
  _exit(lerta_os_write(1, bytes, sizeof bytes) ? 0 : 1);
}
