#include <stdlib.h>

#include <uv.h>

#include "internal.h"

// std:time's sleeps and clock.

typedef struct {
  uv_timer_t handle;
  LertaPromise *promise;
} SleepTimer;

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

static void cancel_sleep(void *context) {
  SleepTimer *timer = context;
  uv_timer_stop(&timer->handle);
  lerta_promise_reject_cancelled(timer->promise);
  lerta_release(timer->promise);
  uv_close((uv_handle_t *)&timer->handle, free_sleep);
}

static void resolve_after(uint64_t milliseconds, LertaPromise *promise) {
  SleepTimer *timer = lerta_checked_malloc(sizeof(SleepTimer));
  timer->promise = promise;
  timer->handle.data = timer;
  lerta_retain(promise);
  uv_loop_t *loop = uv_default_loop();
  uv_timer_init(loop, &timer->handle);
  // libuv counts from the time it last read, as it ran; the program may have run long since.
  uv_update_time(loop);
  uv_timer_start(&timer->handle, end_sleep, milliseconds, 0);
  lerta_promise_on_cancel(promise, cancel_sleep, timer);
}

// std:time rounds the time up, as a sleep must not end early, and checks that it is not negative.
LertaPromise *lerta_sleep_milliseconds(int64_t milliseconds) {
  LertaPromise *promise = lerta_promise_new(LERTA_PLAIN_ITEMS);
  resolve_after((uint64_t)milliseconds, promise);
  return promise;
}

// std:time's clock, read from the system.
double lerta_unix_time(void) {
  return lerta_os_unix_time();
}

int64_t lerta_utc_offset(int64_t seconds) {
  return lerta_os_utc_offset(seconds);
}

// libuv's high-resolution clock, which no setting of the system's clock moves.
double lerta_monotonic_time(void) {
  return (double)uv_hrtime() / 1e9;
}
