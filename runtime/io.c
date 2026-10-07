#include <errno.h>
#include <stdbool.h>
#include <unistd.h>

#include "lerta.h"

enum { STDOUT_FD = 1, STDERR_FD = 2, STDOUT_BUFFER_SIZE = 4096 };

static uint8_t stdout_buffer[STDOUT_BUFFER_SIZE];
static int64_t stdout_buffered = 0;
// Once a write fails, later output is dropped and the program exits non-zero.
static bool stdout_failed = false;

// Returns false if the write failed.
static bool write_all(int fd, const uint8_t *bytes, int64_t length) {
  while (length > 0) {
    ssize_t written = write(fd, bytes, (size_t)length);
    if (written < 0 && errno == EINTR) continue;
    if (written <= 0) return false;
    bytes += written;
    length -= written;
  }
  return true;
}

static void stdout_write_all(const uint8_t *bytes, int64_t length) {
  if (!stdout_failed && !write_all(STDOUT_FD, bytes, length)) stdout_failed = true;
}

bool lerta_stdout_flush(void) {
  stdout_write_all(stdout_buffer, stdout_buffered);
  stdout_buffered = 0;
  return !stdout_failed;
}

static void stdout_write(const uint8_t *bytes, int64_t length) {
  if (stdout_buffered + length > STDOUT_BUFFER_SIZE) lerta_stdout_flush();
  if (length > STDOUT_BUFFER_SIZE) {
    stdout_write_all(bytes, length);
    return;
  }
  for (int64_t i = 0; i < length; i++) stdout_buffer[stdout_buffered + i] = bytes[i];
  stdout_buffered += length;
}

static const uint8_t newline = '\n';

void lerta_print_string(const LertaString *s) {
  stdout_write(s->bytes, s->length);
  stdout_write(&newline, 1);
}

void lerta_print_int(int64_t n) {
  // 19 digits and a sign; digits are produced from the end.
  uint8_t digits[20];
  int64_t start = sizeof digits;
  // Working with the negative value avoids overflow on INT64_MIN.
  int64_t negative = n < 0 ? n : -n;
  do {
    digits[--start] = (uint8_t)('0' - negative % 10);
    negative /= 10;
  } while (negative != 0);
  if (n < 0) digits[--start] = '-';
  stdout_write(digits + start, (int64_t)sizeof digits - start);
  stdout_write(&newline, 1);
}

void lerta_throw(const LertaString *message) {
  // Flush first so that stdout and stderr appear in program order.
  lerta_stdout_flush();
  write_all(STDERR_FD, message->bytes, message->length);
  write_all(STDERR_FD, &newline, 1);
  _exit(1);
}
