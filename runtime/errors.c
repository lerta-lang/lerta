// Errors: exiting with one, raising one as an exception of the program, and panicking.
#include "internal.h"

static const uint8_t newline = '\n';

// Writes the prefix and the bytes to stderr as a line, after what the buffer holds, so that the
// output appears in program order.
static void write_error_line(const char *prefix, const uint8_t *bytes, int64_t length,
                             bool panicking) {
  lerta_output_flush_at_end(panicking);
  lerta_stderr_write_text(prefix);
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

LERTA_STATIC_STRING(index_out_of_range, "index out of range");

void lerta_raise_index_out_of_range(void) {
  lerta_raise(LERTA_INDEX_ERROR, LERTA_STR(index_out_of_range));
}

void lerta_raise_with(LertaErrorKind kind, const LertaString *prefix, const LertaString *detail) {
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
