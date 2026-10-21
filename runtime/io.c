#include <stdlib.h>
#include <string.h>

#include "internal.h"

LERTA_STATIC_STRING(unknown_writer, "a Writer writes to stdout (1) or stderr (2) only");

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

// A read of stdin cannot be stopped once the loop's thread for stdin has started it (see
// runtime/loop.c): a cancelled read leaves it going on, and the chunk it gives is kept for the
// next read, so that no input is lost.
static LertaPromise *stdin_receiver = NULL;
static bool stdin_in_flight = false;
static bool has_leftover = false;
static uint8_t *leftover_bytes;
static int64_t leftover_length;

// On the loop, as a panic touches what only the main thread may: the chunk settles the promise,
// which is taken.
static void settle_stdin_read(LertaPromise *promise, uint8_t *bytes, int64_t length) {
  if (length == LERTA_OUT_OF_MEMORY) lerta_panic("out of memory");
  if (length < 0) {
    lerta_raise(LERTA_IO_ERROR, (const LertaString *)&cannot_read_stdin);
    lerta_promise_reject(promise);
  } else {
    LertaString *chunk = length == 0 ? NULL : lerta_string_from_bytes(bytes, length);
    *(LertaString **)lerta_promise_slot(promise) = chunk;
    lerta_promise_resolve(promise);
  }
  lerta_release(promise);
  free(bytes);
}

static void end_stdin_read(void *context, uint8_t *bytes, int64_t length) {
  (void)context;
  stdin_in_flight = false;
  LertaPromise *promise = stdin_receiver;
  stdin_receiver = NULL;
  if (promise != NULL) {
    settle_stdin_read(promise, bytes, length);
    return;
  }
  has_leftover = true;
  leftover_bytes = bytes;
  leftover_length = length;
}

static void cancel_stdin_read(void *context) {
  LertaPromise *promise = context;
  stdin_receiver = NULL;
  lerta_loop_hold_stdin(false);
  lerta_promise_reject_cancelled(promise);
  lerta_release(promise);
}

LertaPromise *lerta_stdin_read(void) {
  LertaPromise *promise = lerta_promise_new(LERTA_REFERENCE_ITEMS);
  lerta_retain(promise);
  if (has_leftover) {
    has_leftover = false;
    settle_stdin_read(promise, leftover_bytes, leftover_length);
    return promise;
  }
  stdin_receiver = promise;
  lerta_promise_on_cancel(promise, cancel_stdin_read, promise);
  if (stdin_in_flight) {
    lerta_loop_hold_stdin(true);
  } else {
    stdin_in_flight = true;
    lerta_loop_read_stdin(end_stdin_read, NULL);
  }
  return promise;
}

// print and print_error write at once, after what the buffer holds, so that the output keeps its
// order.
void lerta_print_stdout(const LertaString *text) {
  lerta_output_write_now(STDOUT_FD, text->bytes, text->length);
}

void lerta_print_stderr(const LertaString *text) {
  lerta_output_flush();
  lerta_stderr_write_string(text);
}
