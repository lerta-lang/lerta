#include <errno.h>
#include <stdbool.h>
#include <unistd.h>

#include "lerta.h"

enum { STDOUT_FD = 1, STDOUT_BUFFER_SIZE = 4096 };

static uint8_t stdout_buffer[STDOUT_BUFFER_SIZE];
static int64_t stdout_buffered = 0;
// Once a write fails, later output is dropped and the program exits non-zero.
static bool stdout_failed = false;

static void write_all(int fd, const uint8_t *bytes, int64_t length) {
  while (length > 0 && !stdout_failed) {
    ssize_t written = write(fd, bytes, (size_t)length);
    if (written < 0 && errno == EINTR) continue;
    if (written <= 0) {
      stdout_failed = true;
      return;
    }
    bytes += written;
    length -= written;
  }
}

bool lerta_stdout_flush(void) {
  write_all(STDOUT_FD, stdout_buffer, stdout_buffered);
  stdout_buffered = 0;
  return !stdout_failed;
}

static void stdout_write(const uint8_t *bytes, int64_t length) {
  if (stdout_buffered + length > STDOUT_BUFFER_SIZE) lerta_stdout_flush();
  if (length > STDOUT_BUFFER_SIZE) {
    write_all(STDOUT_FD, bytes, length);
    return;
  }
  for (int64_t i = 0; i < length; i++) stdout_buffer[stdout_buffered + i] = bytes[i];
  stdout_buffered += length;
}

void lerta_print(const LertaString *s) {
  static const uint8_t newline = '\n';
  stdout_write(s->bytes, s->length);
  stdout_write(&newline, 1);
}
