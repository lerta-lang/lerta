#include <string.h>

#include "internal.h"

LERTA_STATIC_STRING(unknown_writer, "a Writer writes to stdout (1) or stderr (2) only");

void lerta_stderr_write(const uint8_t *bytes, int64_t length) {
  lerta_os_write(STDERR_FD, bytes, length);
}

static bool check_writer(int64_t fd) {
  if (fd == STDOUT_FD || fd == STDERR_FD) return true;
  lerta_raise(LERTA_VALUE_ERROR, (const LertaString *)&unknown_writer);
  return false;
}

LertaPromise *lerta_stream_write(int64_t fd, const LertaString *bytes) {
  return check_writer(fd) ? lerta_output_write((int)fd, bytes->bytes, bytes->length) : NULL;
}

LertaPromise *lerta_stream_flush(int64_t fd) {
  return check_writer(fd) ? lerta_output_wait((int)fd) : NULL;
}

// print and print_error write at once, after what the buffer holds, so that the output keeps its
// order.
void lerta_print_stdout(const LertaString *text) {
  lerta_output_write_now(STDOUT_FD, text->bytes, text->length);
}

void lerta_print_stderr(const LertaString *text) {
  lerta_output_flush();
  lerta_stderr_write(text->bytes, text->length);
}

static const uint8_t newline = '\n';

// Writes the prefix and the bytes to stderr as a line, after what the buffer holds, so that the
// output appears in program order.
static void write_error_line(const char *prefix, const uint8_t *bytes, int64_t length,
                             bool panicking) {
  lerta_output_flush_at_end(panicking);
  lerta_stderr_write((const uint8_t *)prefix, (int64_t)strlen(prefix));
  lerta_stderr_write(bytes, length);
  lerta_stderr_write(&newline, 1);
}

void lerta_exit_with_error(const LertaString *message) {
  write_error_line("", message->bytes, message->length, false);
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
  write_error_line(message, (const uint8_t *)"", 0, true);
  lerta_os_abort();
}

void lerta_panic_string(const LertaString *message) { lerta_panic_with("", message); }

void lerta_panic_with(const char *prefix, const LertaString *message) {
  write_error_line(prefix, message->bytes, message->length, true);
  lerta_os_abort();
}
