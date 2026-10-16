#include <stdlib.h>
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

LERTA_STATIC_STRING(cannot_read_stdin, "cannot read stdin");

enum { STDIN_CHUNK_SIZE = 65536 };

// A read of stdin on libuv's thread pool, whose worker touches only `bytes`, allocated with malloc,
// and `length`.
typedef struct {
  LertaPromise *promise;
  uint8_t *bytes;
  int64_t length;
} StdinRead;

static void read_stdin_work(void *data) {
  StdinRead *task = data;
  task->bytes = malloc(STDIN_CHUNK_SIZE);
  task->length = task->bytes == NULL ? LERTA_OUT_OF_MEMORY
                                     : lerta_os_read_stdin(task->bytes, STDIN_CHUNK_SIZE);
}

// On the loop, as a panic touches what only the main thread may.
static void end_stdin_read(void *data) {
  StdinRead *task = data;
  if (task->length == LERTA_OUT_OF_MEMORY) lerta_panic("out of memory");
  if (task->length < 0) {
    lerta_raise(LERTA_IO_ERROR, (const LertaString *)&cannot_read_stdin);
    lerta_promise_reject(task->promise);
  } else {
    LertaString *chunk =
        task->length == 0 ? NULL : lerta_string_from_bytes(task->bytes, task->length);
    *(LertaString **)lerta_promise_slot(task->promise) = chunk;
    lerta_promise_resolve(task->promise);
  }
  lerta_release(task->promise);
  free(task->bytes);
  free(task);
}

LertaPromise *lerta_stdin_read(void) {
  StdinRead *task = lerta_checked_calloc(1, sizeof(StdinRead));
  task->promise = lerta_promise_new(LERTA_REFERENCE_ITEMS);
  lerta_retain(task->promise);
  lerta_loop_work(task, read_stdin_work, end_stdin_read);
  return task->promise;
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
