#include <stdatomic.h>
#include <stdlib.h>
#include <string.h>

#include <uv.h>

#include "internal.h"

// The buffer of stdout and stderr and its write out (see docs/internals.md#output).

LERTA_STATIC_STRING(cannot_write_stdout, "cannot write to stdout");
LERTA_STATIC_STRING(cannot_write_stderr, "cannot write to stderr");

enum { BUFFER_LIMIT = 65536 };

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

// A write out of the buffer on a thread of its own, with blocking writes, which leave the file
// descriptors blocking for print and the programs that inherit them; not on libuv's thread pool,
// whose few threads long file operations may hold. One at most is in flight.
typedef struct WriteOut {
  Segments segments;
  // Which streams have failed: those known as it starts, and those that fail in it.
  bool failed[STDERR_FD + 1];
  // Set by the thread once it has written; atomic for a panic, which does not lock the mutex.
  atomic_bool done;
  // Whether the main thread has taken its outcome.
  bool finished;
  // The next of those the thread has written, which the loop has yet to end.
  struct WriteOut *next;
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
// The thread, and what the mutex guards for it: the write out it is asked for, and those it has
// written, in order, which the async handle tells the loop of. The handle is referenced while a
// write out has yet to end, as a request of the thread pool would be.
static uv_thread_t thread;
static bool thread_started = false;
static uv_cond_t wanted;
static WriteOut *requested = NULL;
static WriteOut *written_first = NULL;
static WriteOut *written_last = NULL;
static uv_async_t written_async;
static int64_t unended = 0;
static bool failed[STDERR_FD + 1];
// The bytes written to the buffer and those written out of it, so far.
static int64_t appended = 0;
static int64_t written = 0;
// The Waiters of the promises that wait.
static LertaQueue waiters;

void lerta_output_init(void) {
  lerta_os_stdio_init();
  if (uv_mutex_init(&mutex) != 0 || uv_cond_init(&written_out) != 0) {
    lerta_panic("cannot make the lock of stdout and stderr");
  }
}

static void append(int fd, const uint8_t *bytes, int64_t length) {
  if (length == 0) return;
  Segment *last = buffered.count == 0 ? NULL : &buffered.items[buffered.count - 1];
  if (last == NULL || last->fd != fd) {
    if (buffered.count == buffered.capacity) {
      buffered.items = lerta_grow_buffer(buffered.items, &buffered.capacity, sizeof(Segment), 4);
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

static void write_out_segments(WriteOut *write_out) {
  write_segments(&write_out->segments, write_out->failed);
  // Set before the lock, which a panicking main thread may hold as it spins on it. A waiter that
  // saw it unset under the lock is in uv_cond_wait by the time the lock is taken here.
  atomic_store(&write_out->done, true);
  uv_mutex_lock(&mutex);
  uv_cond_signal(&written_out);
  uv_mutex_unlock(&mutex);
}

// Takes the outcome of a write out that is done. It frees nothing, as a panic may take it; the
// write out is freed by end_write_out, which does not run if the program ends first.
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
  const LertaString *message =
      fd == STDOUT_FD ? LERTA_STR(cannot_write_stdout) : LERTA_STR(cannot_write_stderr);
  lerta_raise(LERTA_IO_ERROR, message);
  lerta_promise_reject(promise);
}

// Settles the promises whose bytes are written out, from the front of the queue, as their targets
// rise in the order they were added. Each is taken out before it is settled, as a release may end
// the program (a rejected promise that nothing awaits), which writes out again.
static void settle_waiters(void) {
  for (;;) {
    Waiter *first = lerta_queue_front(&waiters, sizeof(Waiter));
    if (first == NULL || first->target > written) break;
    Waiter waiter = *first;
    lerta_queue_shift(&waiters);
    if (failed[waiter.fd]) reject_failed(waiter.promise, waiter.fd);
    else lerta_promise_resolve(waiter.promise);
    lerta_release(waiter.promise);
  }
}

static void start_write_out(void);

static void end_write_out(WriteOut *write_out) {
  if (!write_out->finished) finish(write_out);
  free_segments(&write_out->segments);
  free(write_out);
  settle_waiters();
  bool waited = lerta_queue_front(&waiters, sizeof(Waiter)) != NULL;
  if (waited || buffered.bytes >= BUFFER_LIMIT) start_write_out();
}

// A write out is asked for only once the one before is done, so the thread takes each before the
// next comes.
static void write_out_requests(void *unused) {
  (void)unused;
  for (;;) {
    uv_mutex_lock(&mutex);
    while (requested == NULL) uv_cond_wait(&wanted, &mutex);
    WriteOut *write_out = requested;
    requested = NULL;
    uv_mutex_unlock(&mutex);
    write_out_segments(write_out);
    uv_mutex_lock(&mutex);
    if (written_last == NULL) written_first = write_out;
    else written_last->next = write_out;
    written_last = write_out;
    uv_mutex_unlock(&mutex);
    uv_async_send(&written_async);
  }
}

// One callback may come for several sends.
static void end_written(uv_async_t *handle) {
  uv_mutex_lock(&mutex);
  WriteOut *write_out = written_first;
  written_first = written_last = NULL;
  uv_mutex_unlock(&mutex);
  while (write_out != NULL) {
    WriteOut *next = write_out->next;
    if (--unended == 0) uv_unref((uv_handle_t *)handle);
    end_write_out(write_out);
    write_out = next;
  }
}

// Started with the first write out, as most programs write only through print, which needs no
// thread.
static void start_thread(void) {
  thread_started = true;
  bool started = uv_cond_init(&wanted) == 0 &&
                 uv_async_init(uv_default_loop(), &written_async, end_written) == 0 &&
                 uv_thread_create(&thread, write_out_requests, NULL) == 0;
  if (!started) lerta_panic("cannot start the thread that writes out stdout and stderr");
  uv_unref((uv_handle_t *)&written_async);
}

static void start_write_out(void) {
  if (in_flight != NULL || buffered.count == 0) return;
  if (!thread_started) start_thread();
  WriteOut *write_out = lerta_checked_calloc(1, sizeof(WriteOut));
  write_out->segments = take_buffered();
  memcpy(write_out->failed, failed, sizeof failed);
  if (unended++ == 0) uv_ref((uv_handle_t *)&written_async);
  uv_mutex_lock(&mutex);
  requested = write_out;
  uv_cond_signal(&wanted);
  uv_mutex_unlock(&mutex);
  // Only once it is asked for: a panic before, as for a stack overflow, would otherwise wait for a
  // write out that never runs. Its bytes are then lost, or come out of order with the panic's
  // report if the thread has started, as the program ends.
  in_flight = write_out;
}

static LertaPromise *wait_for_written(int fd, int64_t target) {
  LertaPromise *promise = lerta_promise_new(LERTA_PLAIN_ITEMS);
  lerta_retain(promise);
  *(Waiter *)lerta_queue_push(&waiters, sizeof(Waiter)) = (Waiter){promise, fd, target};
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

LertaPromise *lerta_output_write(int fd, const uint8_t *bytes, int64_t length) {
  if (failed[fd]) {
    LertaPromise *promise = lerta_promise_new(LERTA_PLAIN_ITEMS);
    reject_failed(promise, fd);
    return promise;
  }
  append(fd, bytes, length);
  if (buffered.bytes >= BUFFER_LIMIT) return wait_for_written(fd, appended);
  LertaPromise *promise = lerta_promise_new(LERTA_PLAIN_ITEMS);
  lerta_promise_resolve(promise);
  return promise;
}

LertaPromise *lerta_output_wait(int fd) {
  return wait_for_written(fd, appended);
}

void lerta_output_write_now(int fd, const uint8_t *bytes, int64_t length) {
  lerta_output_flush();
  if (!failed[fd] && !lerta_os_write(fd, bytes, length)) failed[fd] = true;
}
