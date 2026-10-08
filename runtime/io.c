#include <errno.h>
#include <stdlib.h>
#include <string.h>
#include <stdbool.h>
#include <unistd.h>

#include "lerta.h"

LERTA_STATIC_STRING(index_out_of_range, "index out of range");
LERTA_STATIC_STRING(unknown_writer, "a Writer writes to stdout (1) or stderr (2) only");

enum { STDOUT_FD = 1, STDERR_FD = 2, STDOUT_BUFFER_SIZE = 4096 };

static uint8_t stdout_buffer[STDOUT_BUFFER_SIZE];
static int64_t stdout_buffered = 0;
// As in C stdio: a terminal shows each write at once, while a pipe or a file gets few large writes.
static bool stdout_is_terminal = false;
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

void lerta_stdout_init(void) {
  stdout_is_terminal = isatty(STDOUT_FD);
}

// The buffer is emptied before it is written, so that a panic during the write, such as a stack
// overflow, does not write it again.
bool lerta_stdout_flush(void) {
  int64_t length = stdout_buffered;
  stdout_buffered = 0;
  stdout_write_all(stdout_buffer, length);
  return !stdout_failed;
}

static void stdout_write(const uint8_t *bytes, int64_t length) {
  if (stdout_buffered + length > STDOUT_BUFFER_SIZE) lerta_stdout_flush();
  if (stdout_is_terminal || length > STDOUT_BUFFER_SIZE) {
    stdout_write_all(bytes, length);
    return;
  }
  for (int64_t i = 0; i < length; i++) stdout_buffer[stdout_buffered + i] = bytes[i];
  stdout_buffered += length;
}

static const uint8_t newline = '\n';

void lerta_stderr_write(const uint8_t *bytes, int64_t length) {
  // stderr is the last resort for reporting; a failure there cannot be reported.
  write_all(STDERR_FD, bytes, length);
}

static void check_writer(int64_t fd) {
  if (fd != STDOUT_FD && fd != STDERR_FD) lerta_throw((const LertaString *)&unknown_writer);
}

void lerta_writer_write(int64_t fd, const LertaString *bytes) {
  check_writer(fd);
  if (fd == STDOUT_FD) {
    stdout_write(bytes->bytes, bytes->length);
    return;
  }
  lerta_stdout_flush();
  lerta_stderr_write(bytes->bytes, bytes->length);
}

void lerta_writer_flush(int64_t fd) {
  check_writer(fd);
  if (fd == STDOUT_FD) lerta_stdout_flush();
}

void lerta_throw(const LertaString *message) {
  // Flush first so that stdout and stderr appear in program order.
  lerta_stdout_flush();
  lerta_stderr_write(message->bytes, message->length);
  lerta_stderr_write(&newline, 1);
  _exit(1);
}

void lerta_throw_index_out_of_range(void) {
  lerta_throw((const LertaString *)&index_out_of_range);
}

void lerta_panic(const char *message) {
  lerta_stdout_flush();
  lerta_stderr_write((const uint8_t *)message, (int64_t)strlen(message));
  lerta_stderr_write(&newline, 1);
  abort();
}
