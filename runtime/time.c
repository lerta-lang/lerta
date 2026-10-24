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

// std:time checks that the time is not negative.
LertaPromise *lerta_sleep(double seconds) {
  // Rounded up, and one more, so as not to end early: libuv's time is in whole milliseconds, so a
  // timer may fire up to one before its time. A sleep of 0 only lets others go first. A time past
  // what milliseconds hold is the longest they do.
  double exact = seconds * 1000;
  uint64_t milliseconds = UINT64_MAX;
  // The largest double below 2^64 is 2^64 - 2048, so the two added below cannot overflow.
  if (exact < 0x1p64) {
    milliseconds = (uint64_t)exact;
    if ((double)milliseconds < exact) milliseconds++;
    if (milliseconds > 0) milliseconds++;
  }
  LertaPromise *promise = lerta_promise_new(LERTA_PLAIN_ITEMS);
  resolve_after(milliseconds, promise);
  return promise;
}

// std:time's clock, read from the system.
double lerta_unix_time(void) {
  return lerta_os_unix_time();
}
