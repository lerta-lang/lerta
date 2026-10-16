#include <string.h>

#include "internal.h"

LERTA_STATIC_STRING(unknown_writer, "a Writer writes to stdout (1) or stderr (2) only");

enum { STDOUT_FD = 1, STDERR_FD = 2, STDOUT_BUFFER_SIZE = 4096 };

static uint8_t stdout_buffer[STDOUT_BUFFER_SIZE];
static int64_t stdout_buffered = 0;
static bool stdout_is_terminal = false;
static bool stdout_failed = false;

static void stdout_write_all(const uint8_t *bytes, int64_t length) {
  if (!stdout_failed && !lerta_os_write(STDOUT_FD, bytes, length)) stdout_failed = true;
}

void lerta_stdout_init(void) {
  lerta_os_stdio_init();
  stdout_is_terminal = lerta_os_is_terminal(STDOUT_FD);
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
  lerta_os_write(STDERR_FD, bytes, length);
}

static bool check_writer(int64_t fd) {
  if (fd == STDOUT_FD || fd == STDERR_FD) return true;
  lerta_raise(LERTA_VALUE_ERROR, (const LertaString *)&unknown_writer);
  return false;
}

void lerta_writer_write(int64_t fd, const LertaString *bytes) {
  if (!check_writer(fd)) return;
  if (fd == STDOUT_FD) {
    stdout_write(bytes->bytes, bytes->length);
    return;
  }
  lerta_stdout_flush();
  lerta_stderr_write(bytes->bytes, bytes->length);
}

void lerta_writer_flush(int64_t fd) {
  if (!check_writer(fd)) return;
  if (fd == STDOUT_FD) lerta_stdout_flush();
}

// print and print_error write at once, whatever the buffering, after what stdout holds, so that
// the output keeps its order.
void lerta_print_stdout(const LertaString *text) {
  lerta_stdout_flush();
  stdout_write_all(text->bytes, text->length);
}

void lerta_print_stderr(const LertaString *text) {
  lerta_stdout_flush();
  lerta_stderr_write(text->bytes, text->length);
}

// Writes the prefix and the bytes to stderr as a line, after flushing stdout so that stdout and
// stderr appear in program order.
static void write_error_line(const char *prefix, const uint8_t *bytes, int64_t length) {
  lerta_stdout_flush();
  lerta_stderr_write((const uint8_t *)prefix, (int64_t)strlen(prefix));
  lerta_stderr_write(bytes, length);
  lerta_stderr_write(&newline, 1);
}

void lerta_exit_with_error(const LertaString *message) {
  write_error_line("", message->bytes, message->length);
  lerta_os_exit(1);
}

static void (*registered_raise)(int32_t kind, const LertaString *message) = NULL;

void lerta_register_raise(void (*raise)(int32_t kind, const LertaString *message)) {
  registered_raise = raise;
}

void lerta_raise(LertaErrorKind kind, const LertaString *message) {
  if (registered_raise == NULL) lerta_exit_with_error(message);
  registered_raise((int32_t)kind, message);
}

void lerta_raise_with(LertaErrorKind kind, const void *prefix, const LertaString *detail) {
  LertaString *message = lerta_string_concat(2, prefix, detail);
  lerta_raise(kind, message);
  lerta_release(message);
}

void lerta_panic(const char *message) {
  write_error_line(message, (const uint8_t *)"", 0);
  lerta_os_abort();
}

void lerta_panic_string(const LertaString *message) { lerta_panic_with("", message); }

void lerta_panic_with(const char *prefix, const LertaString *message) {
  write_error_line(prefix, message->bytes, message->length);
  lerta_os_abort();
}
