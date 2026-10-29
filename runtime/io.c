#include <stdlib.h>
#include <string.h>

#include "internal.h"

void lerta_stderr_write(const uint8_t *bytes, int64_t length) {
  lerta_os_write(STDERR_FD, bytes, length);
}

void lerta_stderr_write_text(const char *text) {
  lerta_stderr_write((const uint8_t *)text, (int64_t)strlen(text));
}

void lerta_stderr_write_string(const LertaString *s) {
  lerta_stderr_write(s->bytes, s->length);
}

void lerta_stderr_write_int(int64_t n) {
  uint8_t buffer[LERTA_INT_TEXT_MAX];
  int64_t start = lerta_format_int(n, buffer);
  lerta_stderr_write(buffer + start, LERTA_INT_TEXT_MAX - start);
}

// std:io checks that the descriptor is stdout's or stderr's.
LertaPromise *lerta_stream_write(int64_t fd, const LertaString *bytes) {
  return lerta_output_write((int)fd, bytes->bytes, bytes->length);
}

LertaPromise *lerta_stream_flush(int64_t fd) {
  return lerta_output_wait((int)fd);
}

// print and print_error write at once, after what the buffer holds, so that the output keeps its
// order.
void lerta_print_stdout(const LertaString *text) {
  lerta_output_write_now(STDOUT_FD, text->bytes, text->length);
}

void lerta_print_stderr(const LertaString *text) {
  lerta_output_write_now(STDERR_FD, text->bytes, text->length);
}
