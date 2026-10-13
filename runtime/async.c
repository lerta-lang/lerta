#include <stdlib.h>
#include <string.h>

#include "internal.h"

// The coroutines ready to go on, in the order they became ready, and the sleeps by when they end.
// The loop resumes the ready ones, then waits for the next sleep to end, until there is neither.
static void **ready = NULL;
static int64_t ready_start = 0;
static int64_t ready_end = 0;
static int64_t ready_capacity = 0;

typedef struct {
  int64_t deadline;
  // Tells apart sleeps that end at the same time, so that they end in the order they began.
  int64_t order;
  LertaPromise *promise;
} Timer;

static Timer *timers = NULL;
static int64_t timer_count = 0;
static int64_t timer_capacity = 0;
static int64_t timers_started = 0;

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

static bool is_earlier(const Timer *a, const Timer *b) {
  return a->deadline != b->deadline ? a->deadline < b->deadline : a->order < b->order;
}

static void swap_timers(int64_t i, int64_t j) {
  Timer t = timers[i];
  timers[i] = timers[j];
  timers[j] = t;
}

// The timers are a binary heap, the earliest first.
static void push_timer(Timer timer) {
  if (timer_count == timer_capacity) {
    timer_capacity = timer_capacity == 0 ? 16 : timer_capacity * 2;
    timers = lerta_checked_realloc(timers, (size_t)timer_capacity * sizeof(Timer));
  }
  int64_t i = timer_count++;
  timers[i] = timer;
  while (i > 0 && is_earlier(&timers[i], &timers[(i - 1) / 2])) {
    swap_timers(i, (i - 1) / 2);
    i = (i - 1) / 2;
  }
}

static Timer pop_timer(void) {
  Timer earliest = timers[0];
  timers[0] = timers[--timer_count];
  int64_t i = 0;
  for (;;) {
    int64_t first = i;
    int64_t left = 2 * i + 1;
    int64_t right = left + 1;
    if (left < timer_count && is_earlier(&timers[left], &timers[first])) first = left;
    if (right < timer_count && is_earlier(&timers[right], &timers[first])) first = right;
    if (first == i) return earliest;
    swap_timers(i, first);
    i = first;
  }
}

enum { PENDING, RESOLVED, REJECTED };

// The value, of the kind, is stored in place, as an item of an array is; a Promise of no value has none.
struct LertaPromise {
  int64_t ref_count;
  void (*drop)(void *object);
  int32_t state;
  // Whether its result has been taken: an exception never taken ends the program when it is dropped.
  bool observed;
  LertaItemKind kind;
  LertaException exception;
  // The coroutines that await it, which become ready when it is settled.
  void **waiters;
  int64_t waiter_count;
  int64_t waiter_capacity;
  _Alignas(8) uint8_t value[16];
};

static void drop_promise(void *object) {
  LertaPromise *promise = object;
  free(promise->waiters);
  if (promise->state == RESOLVED) lerta_release_item(promise->kind, promise->value);
  if (promise->state != REJECTED) return;
  // An exception that nothing awaited would be lost: it ends the program, as an uncaught one does.
  if (!promise->observed) {
    lerta_exception = promise->exception;
    lerta_exit_with_error(lerta_exception_message());
  }
  lerta_release(promise->exception.data);
}

LertaPromise *lerta_promise_new(LertaItemKind kind) {
  LertaPromise *promise = lerta_alloc(sizeof(LertaPromise), drop_promise);
  promise->state = PENDING;
  promise->observed = false;
  promise->kind = kind;
  promise->exception = (LertaException){NULL, NULL};
  promise->waiters = NULL;
  promise->waiter_count = 0;
  promise->waiter_capacity = 0;
  return promise;
}

bool lerta_promise_wait(LertaPromise *promise, void *coroutine) {
  if (promise->state != PENDING) return false;
  if (promise->waiter_count == promise->waiter_capacity) {
    promise->waiter_capacity = promise->waiter_capacity == 0 ? 1 : promise->waiter_capacity * 2;
    size_t size = (size_t)promise->waiter_capacity * sizeof(void *);
    promise->waiters = lerta_checked_realloc(promise->waiters, size);
  }
  promise->waiters[promise->waiter_count++] = coroutine;
  return true;
}

static void settle(LertaPromise *promise, int state) {
  promise->state = state;
  for (int64_t i = 0; i < promise->waiter_count; i++) push_ready(promise->waiters[i]);
  free(promise->waiters);
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
  lerta_exception = (LertaException){NULL, NULL};
  settle(promise, REJECTED);
}

void *lerta_promise_result(LertaPromise *promise) {
  promise->observed = true;
  if (promise->state == REJECTED) {
    lerta_retain(promise->exception.data);
    lerta_exception = promise->exception;
  }
  return promise->value;
}

LERTA_STATIC_STRING(negative_sleep, "sleep for a negative time");

enum { NANOSECONDS_PER_SECOND = 1000000000 };

LertaPromise *lerta_sleep(int64_t seconds) {
  if (seconds < 0) {
    lerta_raise(LERTA_VALUE_ERROR, (const LertaString *)&negative_sleep);
    return NULL;
  }
  LertaPromise *promise = lerta_promise_new(LERTA_PLAIN_ITEMS);
  // The timer holds the promise until it ends; a deadline past the largest Int is the largest.
  int64_t now = lerta_os_monotonic_ns();
  int64_t left = INT64_MAX - now;
  int64_t delay = seconds > left / NANOSECONDS_PER_SECOND ? left : seconds * NANOSECONDS_PER_SECOND;
  lerta_retain(promise);
  push_timer((Timer){now + delay, timers_started++, promise});
  return promise;
}

void lerta_loop_run(void (*resume)(void *coroutine)) {
  for (;;) {
    while (ready_start < ready_end) resume(ready[ready_start++]);
    if (timer_count == 0) break;
    int64_t wait = timers[0].deadline - lerta_os_monotonic_ns();
    if (wait > 0) lerta_os_sleep_ns(wait);
    Timer ended = pop_timer();
    lerta_promise_resolve(ended.promise);
    lerta_release(ended.promise);
  }
}

LERTA_STATIC_STRING(never_settled, "the top-level code awaits a promise that is never settled");

void lerta_finish_top_level(LertaPromise *promise) {
  if (promise->state == PENDING) lerta_exit_with_error((const LertaString *)&never_settled);
  lerta_promise_result(promise);
}
