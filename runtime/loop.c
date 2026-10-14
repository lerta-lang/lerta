#include <stdlib.h>

#include <uv.h>

#include "internal.h"

// What the event loop waits for, on libuv: the one file of the runtime that uses it, so that the
// loop's backend can be replaced (see docs/internals.md#platforms).

typedef struct {
  uv_timer_t handle;
  LertaPromise *promise;
} SleepTimer;

enum { MILLISECONDS_PER_SECOND = 1000 };

static void free_sleep(uv_handle_t *handle) {
  free(handle->data);
}

// The sleep holds its promise until it resolves it.
static void end_sleep(uv_timer_t *handle) {
  SleepTimer *timer = handle->data;
  lerta_promise_resolve(timer->promise);
  lerta_release(timer->promise);
  uv_close((uv_handle_t *)handle, free_sleep);
}

void lerta_loop_resolve_after(int64_t seconds, LertaPromise *promise) {
  SleepTimer *timer = lerta_checked_malloc(sizeof(SleepTimer));
  timer->promise = promise;
  timer->handle.data = timer;
  lerta_retain(promise);
  uv_timer_init(uv_default_loop(), &timer->handle);
  // A time past what libuv's milliseconds hold is the longest it holds.
  uint64_t longest = UINT64_MAX / MILLISECONDS_PER_SECOND;
  uint64_t milliseconds = (uint64_t)seconds > longest ? UINT64_MAX
                                                      : (uint64_t)seconds * MILLISECONDS_PER_SECOND;
  uv_timer_start(&timer->handle, end_sleep, milliseconds, 0);
}

bool lerta_loop_wait(void) {
  uv_loop_t *loop = uv_default_loop();
  if (!uv_loop_alive(loop)) return false;
  uv_run(loop, UV_RUN_ONCE);
  return true;
}
