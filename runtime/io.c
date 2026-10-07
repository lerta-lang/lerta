#include <errno.h>
#include <stdlib.h>
#include <string.h>
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
  uint8_t text[LERTA_INT_TEXT_MAX];
  int64_t start = lerta_format_int(n, text);
  stdout_write(text + start, LERTA_INT_TEXT_MAX - start);
  stdout_write(&newline, 1);
}

void lerta_print_bool(bool b) {
  static const uint8_t true_text[] = "true";
  static const uint8_t false_text[] = "false";
  if (b) {
    stdout_write(true_text, sizeof true_text - 1);
  } else {
    stdout_write(false_text, sizeof false_text - 1);
  }
  stdout_write(&newline, 1);
}

void lerta_stderr_write(const uint8_t *bytes, int64_t length) {
  // stderr is the last resort for reporting; a failure there cannot be reported.
  write_all(STDERR_FD, bytes, length);
}

void lerta_throw(const LertaString *message) {
  // Flush first so that stdout and stderr appear in program order.
  lerta_stdout_flush();
  lerta_stderr_write(message->bytes, message->length);
  lerta_stderr_write(&newline, 1);
  _exit(1);
}

void lerta_panic(const char *message) {
  lerta_stdout_flush();
  lerta_stderr_write((const uint8_t *)message, (int64_t)strlen(message));
  lerta_stderr_write(&newline, 1);
  abort();
}
