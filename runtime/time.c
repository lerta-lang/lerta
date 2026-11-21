#include <stdlib.h>

#include <uv.h>

#include "internal.h"

// std:time's sleeps and clock.

typedef struct SleepTimer {
  uv_timer_t handle;
  LertaPromise *promise;
  bool holds;
  // The sleeps that do not hold the program and have not ended, linked, for its end to cancel.
  struct SleepTimer *previous;
  struct SleepTimer *next;
} SleepTimer;

static SleepTimer *unheld_sleeps = NULL;

static void free_sleep(uv_handle_t *handle) {
  free(handle->data);
}

// The sleep holds its promise until it settles it.
static void close_sleep(SleepTimer *timer) {
  if (!timer->holds) {
    if (timer->previous != NULL) timer->previous->next = timer->next;
    else unheld_sleeps = timer->next;
    if (timer->next != NULL) timer->next->previous = timer->previous;
  }
  lerta_release(timer->promise);
  uv_close((uv_handle_t *)&timer->handle, free_sleep);
}

static void end_sleep(uv_timer_t *handle) {
  SleepTimer *timer = handle->data;
  lerta_promise_resolve(timer->promise);
  close_sleep(timer);
}

static void cancel_sleep(void *context) {
  SleepTimer *timer = context;
  uv_timer_stop(&timer->handle);
  lerta_promise_reject_cancelled(timer->promise);
  close_sleep(timer);
}

// A sleep that does not hold the program leaves it to end without waiting for the sleep.
static void resolve_after(uint64_t milliseconds, LertaPromise *promise, bool holds) {
  SleepTimer *timer = lerta_checked_malloc(sizeof(SleepTimer));
  *timer = (SleepTimer){.promise = promise, .holds = holds};
  timer->handle.data = timer;
  if (!holds) {
    timer->next = unheld_sleeps;
    if (unheld_sleeps != NULL) unheld_sleeps->previous = timer;
    unheld_sleeps = timer;
  }
  lerta_retain(promise);
  uv_loop_t *loop = lerta_loop();
  uv_timer_init(loop, &timer->handle);
  // libuv counts from the time it last read, as it ran; the program may have run long since.
  uv_update_time(loop);
  uv_timer_start(&timer->handle, end_sleep, milliseconds, 0);
  if (!holds) uv_unref((uv_handle_t *)&timer->handle);
  lerta_promise_on_cancel(promise, cancel_sleep, timer);
}

// std:time rounds the time up, as a sleep must not end early, and checks that it is not negative.
LertaPromise *lerta_sleep_milliseconds(int64_t milliseconds) {
  LertaPromise *promise = lerta_promise_new(LERTA_PLAIN_ITEMS);
  resolve_after((uint64_t)milliseconds, promise, true);
  return promise;
}

// A sleep that bounds a wait that holds the program itself, as a read does (see
// std/internal/deadline.lerta).
LertaPromise *lerta_sleep_unheld_milliseconds(int64_t milliseconds) {
  LertaPromise *promise = lerta_promise_new(LERTA_PLAIN_ITEMS);
  resolve_after((uint64_t)milliseconds, promise, false);
  return promise;
}

// Once nothing holds the program, its end cancels the sleeps that do not hold it, so that what
// awaits them ends rather than stays, and is a leak. Only once: what they end may start more, which
// would be cancelled again without end.
bool lerta_end_unheld_sleeps(void) {
  static bool ended = false;
  if (ended || unheld_sleeps == NULL) return false;
  ended = true;
  while (unheld_sleeps != NULL) cancel_sleep(unheld_sleeps);
  return true;
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
