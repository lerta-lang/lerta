#include <stdlib.h>

#include <uv.h>

#include "internal.h"

// stdin is read with blocking reads on a thread of its own, as Deno and Go read it, rather than as
// a libuv stream, which would make descriptor 0 non-blocking for the programs that share it, and
// rather than on the thread pool, whose few threads a read that waits for input would hold.
enum { STDIN_CHUNK_SIZE = 65536 };

static uv_thread_t stdin_thread;
static uv_async_t stdin_done;
static uv_mutex_t stdin_mutex;
static uv_cond_t stdin_wanted;
static bool stdin_started = false;
// Set by the loop to ask for a chunk, and cleared by the thread with the chunk, under the mutex.
static bool stdin_requested = false;
static uint8_t *stdin_bytes;
static int64_t stdin_length;

// The thread touches only what the mutex guards, and the bytes it allocates with malloc.
static void read_stdin_chunks(void *unused) {
  (void)unused;
  for (;;) {
    uv_mutex_lock(&stdin_mutex);
    while (!stdin_requested) uv_cond_wait(&stdin_wanted, &stdin_mutex);
    uv_mutex_unlock(&stdin_mutex);
    uint8_t *bytes = malloc(STDIN_CHUNK_SIZE);
    int64_t length =
        bytes == NULL ? LERTA_OUT_OF_MEMORY : lerta_os_read_stdin(bytes, STDIN_CHUNK_SIZE);
    if (length <= 0) {
      free(bytes);
      bytes = NULL;
    }
    uv_mutex_lock(&stdin_mutex);
    stdin_bytes = bytes;
    stdin_length = length;
    stdin_requested = false;
    uv_mutex_unlock(&stdin_mutex);
    uv_async_send(&stdin_done);
  }
}

LERTA_STATIC_STRING(cannot_read_stdin, "cannot read stdin");

// A read of stdin cannot be stopped once the thread has started it: a cancelled read leaves it
// going on, and the chunk it gives is kept for the next read, so that no input is lost. The async
// handle is referenced only while a promise waits for the chunk, so that a read that nothing waits
// for does not keep the program running.
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

// Each request makes one send, so the callback always has the chunk that the request asked for.
static void end_stdin_read(uv_async_t *handle) {
  uv_mutex_lock(&stdin_mutex);
  uint8_t *bytes = stdin_bytes;
  int64_t length = stdin_length;
  uv_mutex_unlock(&stdin_mutex);
  stdin_in_flight = false;
  uv_unref((uv_handle_t *)handle);
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

static void start_stdin_thread(void) {
  stdin_started = true;
  uv_mutex_init(&stdin_mutex);
  uv_cond_init(&stdin_wanted);
  uv_async_init(uv_default_loop(), &stdin_done, end_stdin_read);
  uv_unref((uv_handle_t *)&stdin_done);
  if (uv_thread_create(&stdin_thread, read_stdin_chunks, NULL) != 0) {
    lerta_panic("cannot start the thread that reads stdin");
  }
}

static void request_stdin_chunk(void) {
  if (!stdin_started) start_stdin_thread();
  stdin_in_flight = true;
  uv_mutex_lock(&stdin_mutex);
  stdin_requested = true;
  uv_cond_signal(&stdin_wanted);
  uv_mutex_unlock(&stdin_mutex);
}

static void cancel_stdin_read(void *context) {
  LertaPromise *promise = context;
  stdin_receiver = NULL;
  uv_unref((uv_handle_t *)&stdin_done);
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
  // Referenced while this promise waits, after the first request has made it.
  if (!stdin_in_flight) request_stdin_chunk();
  uv_ref((uv_handle_t *)&stdin_done);
  return promise;
}
