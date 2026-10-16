#include <stdatomic.h>
#include <stdlib.h>
#include <string.h>

#include <uv.h>

#include "internal.h"

// See docs/internals.md#output.

LERTA_STATIC_STRING(unknown_writer, "a Writer writes to stdout (1) or stderr (2) only");
LERTA_STATIC_STRING(cannot_write_stdout, "cannot write to stdout");
LERTA_STATIC_STRING(cannot_write_stderr, "cannot write to stderr");

enum { STDOUT_FD = 1, STDERR_FD = 2, BUFFER_LIMIT = 65536 };

// Consecutive bytes for one stream. The buffer holds those of both streams in the order they were
// written, so that the two keep their order when they go to the same place.
typedef struct {
  int fd;
  uint8_t *bytes;
  int64_t length;
  int64_t capacity;
} Segment;

typedef struct {
  Segment *items;
  int64_t count;
  int64_t capacity;
  int64_t bytes;
} Segments;

// A write out of the buffer on libuv's thread pool, with blocking writes, which leave the file
// descriptors blocking for print and the programs that inherit them. One at most is in flight.
typedef struct {
  uv_work_t request;
  Segments segments;
  // Which streams have failed: those known as it starts, and those that fail in it.
  bool failed[3];
  // Set by the worker once it has written; atomic for a panic, which does not lock the mutex.
  atomic_bool done;
  // Whether the main thread has taken its outcome.
  bool finished;
} WriteOut;

// A promise of a Writer, settled once the bytes up to `target` are written out.
typedef struct {
  LertaPromise *promise;
  int fd;
  int64_t target;
} Waiter;

static Segments buffered;
static WriteOut *in_flight = NULL;
static uv_mutex_t mutex;
static uv_cond_t written_out;
static bool failed[3];
// The bytes written to the buffer and those written out of it, so far.
static int64_t appended = 0;
static int64_t written = 0;
// A queue of the promises that wait, from waiter_start up to waiter_end.
static Waiter *waiters = NULL;
static int64_t waiter_start = 0;
static int64_t waiter_end = 0;
static int64_t waiter_capacity = 0;

void lerta_output_init(void) {
  lerta_os_stdio_init();
  uv_mutex_init(&mutex);
  uv_cond_init(&written_out);
}

static void append(int fd, const uint8_t *bytes, int64_t length) {
  if (length == 0) return;
  Segment *last = buffered.count == 0 ? NULL : &buffered.items[buffered.count - 1];
  if (last == NULL || last->fd != fd) {
    if (buffered.count == buffered.capacity) {
      buffered.capacity = buffered.capacity == 0 ? 4 : buffered.capacity * 2;
      buffered.items =
          lerta_checked_realloc(buffered.items, (size_t)buffered.capacity * sizeof(Segment));
    }
    last = &buffered.items[buffered.count++];
    *last = (Segment){fd, NULL, 0, 0};
  }
  if (last->length + length > last->capacity) {
    int64_t capacity = last->capacity == 0 ? 256 : last->capacity;
    while (capacity < last->length + length) capacity *= 2;
    last->bytes = lerta_checked_realloc(last->bytes, (size_t)capacity);
    last->capacity = capacity;
  }
  memcpy(last->bytes + last->length, bytes, (size_t)length);
  last->length += length;
  buffered.bytes += length;
  appended += length;
}

// The bytes of a stream that has failed are dropped.
static void write_segments(const Segments *segments, bool *fails) {
  for (int64_t i = 0; i < segments->count; i++) {
    const Segment *segment = &segments->items[i];
    if (fails[segment->fd]) continue;
    if (!lerta_os_write(segment->fd, segment->bytes, segment->length)) fails[segment->fd] = true;
  }
}

static void free_segments(Segments *segments) {
  for (int64_t i = 0; i < segments->count; i++) free(segments->items[i].bytes);
  free(segments->items);
}

// Taken out of the buffer before it is written, so that a panic during the write, such as a stack
// overflow, does not write it again.
static Segments take_buffered(void) {
  Segments taken = buffered;
  buffered = (Segments){NULL, 0, 0, 0};
  return taken;
}

static void work(uv_work_t *request) {
  WriteOut *write_out = request->data;
  write_segments(&write_out->segments, write_out->failed);
  // Set before the lock, which a panicking main thread may hold as it spins on it. A waiter that
  // saw it unset under the lock is in uv_cond_wait by the time the lock is taken here.
  atomic_store(&write_out->done, true);
  uv_mutex_lock(&mutex);
  uv_cond_signal(&written_out);
  uv_mutex_unlock(&mutex);
}

// Takes the outcome of a write out that is done. It frees nothing, as a panic may take it; the
// write out is freed by after_work, which does not run if the program ends first.
static void finish(WriteOut *write_out) {
  // Merged before in_flight is cleared, so that the next write out starts knowing the failures.
  for (int fd = STDOUT_FD; fd <= STDERR_FD; fd++) failed[fd] = failed[fd] || write_out->failed[fd];
  written += write_out->segments.bytes;
  write_out->finished = true;
  if (in_flight == write_out) in_flight = NULL;
}

// A panic, which may come from a signal handler, as for a stack overflow, while this thread holds
// the mutex, spins instead of locking it.
static void wait_in_flight(bool panicking) {
  if (in_flight == NULL) return;
  if (panicking) {
    while (!atomic_load(&in_flight->done)) {}
  } else {
    uv_mutex_lock(&mutex);
    while (!atomic_load(&in_flight->done)) uv_cond_wait(&written_out, &mutex);
    uv_mutex_unlock(&mutex);
  }
  finish(in_flight);
}

static void reject_failed(LertaPromise *promise, int fd) {
  const void *message =
      fd == STDOUT_FD ? (const void *)&cannot_write_stdout : (const void *)&cannot_write_stderr;
  lerta_raise(LERTA_IO_ERROR, message);
  lerta_promise_reject(promise);
}

// Settles the promises whose bytes are written out, from the front of the queue, as their targets
// rise in the order they were added. Each is taken out before it is settled, as a release may end
// the program (a rejected promise that nothing awaits), which writes out again.
static void settle_waiters(void) {
  while (waiter_start < waiter_end && waiters[waiter_start].target <= written) {
    Waiter waiter = waiters[waiter_start++];
    if (failed[waiter.fd]) reject_failed(waiter.promise, waiter.fd);
    else lerta_promise_resolve(waiter.promise);
    lerta_release(waiter.promise);
  }
}

static void start_write_out(void);

static void after_work(uv_work_t *request, int status) {
  (void)status;
  WriteOut *write_out = request->data;
  if (!write_out->finished) finish(write_out);
  free_segments(&write_out->segments);
  free(write_out);
  settle_waiters();
  if (waiter_start < waiter_end || buffered.bytes >= BUFFER_LIMIT) start_write_out();
}

static void start_write_out(void) {
  if (in_flight != NULL || buffered.count == 0) return;
  WriteOut *write_out = lerta_checked_calloc(1, sizeof(WriteOut));
  write_out->request.data = write_out;
  write_out->segments = take_buffered();
  memcpy(write_out->failed, failed, sizeof failed);
  uv_queue_work(uv_default_loop(), &write_out->request, work, after_work);
  // Only once it is queued: a panic in uv_queue_work, as for a stack overflow, would otherwise wait
  // for a write out that never runs. Its bytes are then lost, or come out of order with the panic's
  // report if the worker has started, as the program ends.
  in_flight = write_out;
}

static LertaPromise *wait_for_written(int fd, int64_t target) {
  LertaPromise *promise = lerta_promise_new(LERTA_PLAIN_ITEMS);
  // The settled ones are dropped from the front before the queue grows.
  if (waiter_end == waiter_capacity && waiter_start > 0) {
    int64_t length = waiter_end - waiter_start;
    memmove(waiters, waiters + waiter_start, (size_t)length * sizeof(Waiter));
    waiter_start = 0;
    waiter_end = length;
  }
  if (waiter_end == waiter_capacity) {
    waiter_capacity = waiter_capacity == 0 ? 4 : waiter_capacity * 2;
    waiters = lerta_checked_realloc(waiters, (size_t)waiter_capacity * sizeof(Waiter));
  }
  lerta_retain(promise);
  waiters[waiter_end++] = (Waiter){promise, fd, target};
  start_write_out();
  settle_waiters();
  return promise;
}

static Segments write_out_now(bool panicking) {
  wait_in_flight(panicking);
  Segments taken = take_buffered();
  write_segments(&taken, failed);
  written += taken.bytes;
  return taken;
}

// What it writes out is not freed, as the stack may have overflowed inside malloc.
bool lerta_output_flush_at_end(bool panicking) {
  write_out_now(panicking);
  return !failed[STDOUT_FD];
}

void lerta_output_flush(void) {
  Segments taken = write_out_now(false);
  free_segments(&taken);
  settle_waiters();
}

void lerta_stderr_write(const uint8_t *bytes, int64_t length) {
  // stderr is the last resort for reporting; a failure there cannot be reported.
  lerta_os_write(STDERR_FD, bytes, length);
}

static bool check_writer(int64_t fd) {
  if (fd == STDOUT_FD || fd == STDERR_FD) return true;
  lerta_raise(LERTA_VALUE_ERROR, (const LertaString *)&unknown_writer);
  return false;
}

// A write that leaves the buffer within its limit is resolved at once; one that fills it, once its
// bytes are written out.
LertaPromise *lerta_stream_write(int64_t fd, const LertaString *bytes) {
  if (!check_writer(fd)) return NULL;
  if (failed[fd]) {
    LertaPromise *promise = lerta_promise_new(LERTA_PLAIN_ITEMS);
    reject_failed(promise, (int)fd);
    return promise;
  }
  append((int)fd, bytes->bytes, bytes->length);
  if (buffered.bytes >= BUFFER_LIMIT) return wait_for_written((int)fd, appended);
  LertaPromise *promise = lerta_promise_new(LERTA_PLAIN_ITEMS);
  lerta_promise_resolve(promise);
  return promise;
}

LertaPromise *lerta_stream_flush(int64_t fd) {
  if (!check_writer(fd)) return NULL;
  return wait_for_written((int)fd, appended);
}

// The seed's IR calls these, which write at once, until the next refresh.
void lerta_writer_write(int64_t fd, const LertaString *bytes) {
  if (!check_writer(fd)) return;
  lerta_output_flush();
  if (!failed[fd] && !lerta_os_write((int)fd, bytes->bytes, bytes->length)) failed[fd] = true;
}

void lerta_writer_flush(int64_t fd) {
  if (check_writer(fd)) lerta_output_flush();
}

// print and print_error write at once, after what the buffer holds, so that the output keeps its
// order.
void lerta_print_stdout(const LertaString *text) {
  lerta_output_flush();
  if (!failed[STDOUT_FD] && !lerta_os_write(STDOUT_FD, text->bytes, text->length)) {
    failed[STDOUT_FD] = true;
  }
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
