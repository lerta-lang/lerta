// macOS rejects a write of more than INT_MAX bytes at once. The buffer is never touched, so its
// pages are never made.
#include <fcntl.h>
#include <stdlib.h>
#include <unistd.h>
#include "internal.h"

void lerta_main(void) {
  int64_t length = ((int64_t)1 << 31) + 1;
  uint8_t *bytes = malloc((size_t)length);
  int fd = open("/dev/null", O_WRONLY);
  if (bytes == NULL || fd < 0) _exit(2);
  _exit(lerta_os_write(fd, bytes, length) ? 0 : 1);
}
