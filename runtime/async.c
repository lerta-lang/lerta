#include <stdlib.h>
#include <string.h>

#include "internal.h"

static void **ready = NULL;
static int64_t ready_start = 0;
static int64_t ready_end = 0;
static int64_t ready_capacity = 0;

static void push_ready(void *coroutine) {
  // The ones already resumed are dropped from the front before the queue grows.
  if (ready_end == ready_capacity && ready_start > 0) {
    int64_t length = ready_end - ready_start;
    memmove(ready, ready + ready_start, (size_t)length * sizeof(void *));
    ready_start = 0;
    ready_end = length;
  }
  if (ready_end == ready_capacity) {
    ready_capacity = ready_capacity == 0 ? 16 : ready_capacity * 2;
    ready = lerta_checked_realloc(ready, (size_t)ready_capacity * sizeof(void *));
  }
  ready[ready_end++] = coroutine;
}

enum { PENDING, RESOLVED, REJECTED };

struct LertaPromise {
  int64_t ref_count;
  void (*drop)(void *object);
  int32_t state;
  // Whether its result has been taken.
  bool observed;
  // Whether a cancel has gone through it: a CancelledError that rejects it, dropped, ends nothing,
  // as nothing need take that of work that was given up, while any other error does.
  bool cancelled;
  LertaItemKind kind;
  LertaException exception;
  // The exception's trace, while it is rejected.
  LertaTrace *trace;
  // The coroutines that await it, which become ready when it is settled.
  void **waiters;
  int64_t waiter_count;
  int64_t waiter_capacity;
  // For the promise of a function that awaits: the promise that its body waits for, which
  // cancel follows, and whether the body is to throw a CancelledError as it resumes.
  LertaPromise *awaiting;
  bool cancel_requested;
  // For a promise that the runtime settles: what stops the work that settles it, if anything can.
  LertaCancel cancel;
  void *cancel_context;
  _Alignas(8) uint8_t value[16];
};

LERTA_STATIC_STRING(cancelled, "cancelled");

// The drop function of CancelledError, which tells its type, as the generated code's type tests do
// (see emit_type_test); the first cancel gives it.
static void (*cancelled_error_drop)(void *object) = NULL;

static void raise_cancelled(void) {
  lerta_raise(LERTA_CANCELLED_ERROR, (const LertaString *)&cancelled);
  cancelled_error_drop = ((LertaHeader *)lerta_exception.data)->drop;
}

static bool is_given_up(const LertaPromise *promise) {
  if (!promise->cancelled || cancelled_error_drop == NULL) return false;
  return ((LertaHeader *)promise->exception.data)->drop == cancelled_error_drop;
}

static void drop_promise(void *object) {
  LertaPromise *promise = object;
  lerta_mem_free(promise->waiters);
  if (promise->state == RESOLVED) lerta_release_item(promise->kind, promise->value);
  if (promise->state != REJECTED) return;
  // An exception that nothing awaited would be lost: it ends the program, as an uncaught one does.
  if (!promise->observed && !is_given_up(promise)) {
    lerta_exception = promise->exception;
    lerta_trace_load(promise->trace);
    lerta_exit_with_exception();
  }
  lerta_trace_free(promise->trace);
  lerta_release(promise->exception.data);
}

LertaPromise *lerta_promise_new(LertaItemKind kind) {
  LertaPromise *promise = lerta_alloc(sizeof(LertaPromise), drop_promise);
  promise->state = PENDING;
  promise->observed = false;
  promise->kind = kind;
  promise->exception = (LertaException){NULL, NULL};
  promise->trace = NULL;
  promise->waiters = NULL;
  promise->waiter_count = 0;
  promise->waiter_capacity = 0;
  promise->awaiting = NULL;
  promise->cancel_requested = false;
  promise->cancelled = false;
  promise->cancel = NULL;
  promise->cancel_context = NULL;
  return promise;
}

bool lerta_promise_wait(LertaPromise *promise, void *coroutine) {
  if (promise->state != PENDING) return false;
  if (promise->waiter_count == promise->waiter_capacity) {
    promise->waiter_capacity = promise->waiter_capacity == 0 ? 1 : promise->waiter_capacity * 2;
    size_t size = (size_t)promise->waiter_capacity * sizeof(void *);
    promise->waiters = lerta_mem_realloc(promise->waiters, (int64_t)size);
  }
  promise->waiters[promise->waiter_count++] = coroutine;
  return true;
}

static void settle(LertaPromise *promise, int state) {
  promise->state = state;
  promise->cancel = NULL;
  for (int64_t i = 0; i < promise->waiter_count; i++) push_ready(promise->waiters[i]);
  lerta_mem_free(promise->waiters);
  promise->waiters = NULL;
  promise->waiter_count = 0;
  promise->waiter_capacity = 0;
}

void *lerta_promise_slot(LertaPromise *promise) {
  return promise->value;
}

void lerta_promise_resolve(LertaPromise *promise) {
  settle(promise, RESOLVED);
}

void lerta_promise_reject(LertaPromise *promise) {
  promise->exception = lerta_exception;
  promise->trace = lerta_trace_save();
  lerta_exception = (LertaException){NULL, NULL};
  settle(promise, REJECTED);
}

void *lerta_promise_result(LertaPromise *promise) {
  promise->observed = true;
  if (promise->state == REJECTED) {
    lerta_retain(promise->exception.data);
    lerta_exception = promise->exception;
    lerta_trace_load(promise->trace);
  }
  return promise->value;
}

static void reject_pending(void *promise) {
  lerta_promise_reject_cancelled(promise);
}

// A Promise without a value that the program resolves, which std:async's Deferred awaits.
LertaPromise *lerta_promise_pending(void) {
  LertaPromise *promise = lerta_promise_new(LERTA_PLAIN_ITEMS);
  lerta_promise_on_cancel(promise, reject_pending, promise);
  return promise;
}

// Resolves the promise, unless it is settled already.
void lerta_promise_fire(LertaPromise *promise) {
  if (promise->state == PENDING) lerta_promise_resolve(promise);
}

bool lerta_promise_wait_in(LertaPromise *promise, void *coroutine, LertaPromise *own) {
  if (!lerta_promise_wait(promise, coroutine)) return false;
  own->awaiting = promise;
  return true;
}

void *lerta_promise_result_in(LertaPromise *promise, LertaPromise *own) {
  own->awaiting = NULL;
  if (!own->cancel_requested) return lerta_promise_result(promise);
  own->cancel_requested = false;
  raise_cancelled();
  return promise->value;
}

void lerta_promise_on_cancel(LertaPromise *promise, LertaCancel cancel, void *context) {
  promise->cancel = cancel;
  promise->cancel_context = context;
}

void lerta_promise_reject_cancelled(LertaPromise *promise) {
  raise_cancelled();
  lerta_promise_reject(promise);
}

// The body that waits deepest, through the promises that the bodies wait for, throws a
// CancelledError as it resumes; the work at the end, if it can be stopped, is, which rejects its
// promise, so that the body resumes at once. Work that cannot be stopped ends first.
void lerta_promise_cancel(LertaPromise *promise) {
  if (promise->state != PENDING) return;
  LertaPromise *deepest_body = NULL;
  LertaPromise *end = promise;
  end->cancelled = true;
  while (end->awaiting != NULL) {
    deepest_body = end;
    end = end->awaiting;
    end->cancelled = true;
  }
  if (deepest_body != NULL) deepest_body->cancel_requested = true;
  LertaCancel cancel = end->cancel;
  if (end->state != PENDING || cancel == NULL) return;
  end->cancel = NULL;
  cancel(end->cancel_context);
}

LERTA_STATIC_STRING(negative_sleep, "sleep for a negative time");

LertaPromise *lerta_sleep(double seconds) {
  if (seconds < 0) {
    lerta_raise(LERTA_VALUE_ERROR, (const LertaString *)&negative_sleep);
    return NULL;
  }
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
  lerta_loop_resolve_after(milliseconds, promise);
  return promise;
}

void lerta_loop_run(void (*resume)(void *coroutine)) {
  for (;;) {
    while (ready_start < ready_end) resume(ready[ready_start++]);
    if (!lerta_loop_wait()) break;
  }
}

LERTA_STATIC_STRING(never_settled, "the top-level code awaits a promise that is never settled");

void lerta_finish_top_level(LertaPromise *promise) {
  if (promise->state == PENDING) lerta_exit_with_error((const LertaString *)&never_settled);
  lerta_promise_result(promise);
}

// std:time's clock, read from the system.
double lerta_unix_time(void) {
  return lerta_os_unix_time();
}
