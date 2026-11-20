// macOS rejects a write of more than INT_MAX bytes at once. The buffer is never touched, so its
// pages are never made. A 32-bit process has no room for it, so it exits with SKIPPED there.
#include <fcntl.h>
#include <stdlib.h>
#include <unistd.h>
#include "internal.h"

enum { SKIPPED = 77 };

void lerta_main(void) {
  if (sizeof(void *) < 8) _exit(SKIPPED);
  int64_t length = ((int64_t)1 << 31) + 1;
  uint8_t *bytes = malloc((size_t)length);
  int fd = open("/dev/null", O_WRONLY);
  if (bytes == NULL || fd < 0) _exit(2);
  _exit(lerta_os_write(fd, bytes, length) ? 0 : 1);
}
