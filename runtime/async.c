#include <stdlib.h>
#include <string.h>

#include "internal.h"

// The coroutines to resume.
static LertaQueue ready;

static void push_ready(void *coroutine) {
  *(void **)lerta_queue_push(&ready, sizeof(void *)) = coroutine;
}

enum { PENDING, RESOLVED, REJECTED };

struct LertaPromise {
  int64_t ref_count;
  const LertaType *type;
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

// The type of CancelledError, as the generated code's type tests tell it (see emit_type_test); the
// first cancel gives it.
static const LertaType *cancelled_error_type = NULL;

static void raise_cancelled(void) {
  lerta_raise(LERTA_CANCELLED_ERROR, LERTA_STR(cancelled));
  cancelled_error_type = ((LertaHeader *)lerta_exception.data)->type;
}

static bool is_given_up(const LertaPromise *promise) {
  if (!promise->cancelled || cancelled_error_type == NULL) return false;
  return ((LertaHeader *)promise->exception.data)->type == cancelled_error_type;
}

// Its waiters are coroutines, which hold it rather than it them.
static inline void visit_promise(void *object, LertaVisitor visitor) {
  LertaPromise *promise = object;
  if (promise->state == RESOLVED) lerta_visit_item(promise->kind, promise->value, visitor);
  if (promise->state == REJECTED) visitor(promise->exception.data);
}

// The exception of a rejected promise ends the program, as an uncaught one does.
static void exit_with_rejection(LertaPromise *promise) {
  lerta_exception = promise->exception;
  lerta_trace_load(promise->trace);
  lerta_exit_with_exception();
}

static void drop_promise(void *object) {
  LertaPromise *promise = object;
  lerta_mem_free(promise->waiters);
  if (promise->state == REJECTED) {
    // An exception that nothing awaited would be lost: it ends the program, as an uncaught one
    // does.
    if (!promise->observed && !is_given_up(promise)) exit_with_rejection(promise);
    lerta_trace_free(promise->trace);
  }
  visit_promise(object, lerta_release);
}

LERTA_STATIC_STRING(promise_name, "Promise");
static const LertaType promise_type = {
    drop_promise, visit_promise, LERTA_STR(promise_name)};

LertaPromise *lerta_promise_new(LertaItemKind kind) {
  LertaPromise *promise = lerta_new(sizeof(LertaPromise), &promise_type);
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

bool lerta_promise_wait_in(LertaPromise *promise, void *coroutine, LertaPromise *own) {
  if (promise->state != PENDING) return false;
  if (promise->waiter_count == promise->waiter_capacity) {
    promise->waiter_capacity = promise->waiter_capacity == 0 ? 1 : promise->waiter_capacity * 2;
    size_t size = (size_t)promise->waiter_capacity * sizeof(void *);
    promise->waiters = lerta_mem_realloc(promise->waiters, (int64_t)size);
  }
  promise->waiters[promise->waiter_count++] = coroutine;
  own->awaiting = promise;
  return true;
}

// The program's top-level code, once it awaits (see lerta_watch_top_level).
static LertaPromise *top_level = NULL;

// Once a signal has cancelled the top-level code, the program ends by the signal as soon as the code
// is settled, without waiting for the loop, unless an error other than the cancel rejects it.
// Otherwise a signal from then on takes its default action, as no code is left to cancel.
static void end_if_interrupted(LertaPromise *promise) {
  if (promise != top_level) return;
  if (lerta_signal_received() == 0) {
    lerta_signals_unwatch();
    return;
  }
  if (promise->state == REJECTED && !is_given_up(promise)) return;
  lerta_end_by_signal();
}

static void settle(LertaPromise *promise, int state) {
  promise->state = state;
  end_if_interrupted(promise);
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
  if (promise == top_level) exit_with_rejection(promise);
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

void *lerta_promise_result_in(LertaPromise *promise, LertaPromise *own) {
  own->awaiting = NULL;
  if (!own->cancel_requested) return lerta_promise_result(promise);
  own->cancel_requested = false;
  // The cancel takes the place of what the promise holds, which is given up: a rejection that
  // nothing takes would otherwise end the program once the promise is dropped. Another await may
  // still take it.
  promise->observed = true;
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

void lerta_promise_reject_io(LertaPromise *promise, const LertaString *prefix,
                             const LertaString *detail) {
  lerta_raise_with(LERTA_IO_ERROR, prefix, detail);
  lerta_promise_reject(promise);
}

bool lerta_promise_is_settled(const LertaPromise *promise) { return promise->state != PENDING; }

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

void lerta_loop_run(void (*resume)(void *coroutine)) {
  for (;;) {
    void **next;
    while ((next = lerta_queue_front(&ready, sizeof(void *))) != NULL) {
      void *coroutine = *next;
      lerta_queue_shift(&ready);
      resume(coroutine);
    }
    if (!lerta_loop_wait()) break;
  }
}

// The program's top-level code that throws ends the program at once, though the loop would still
// wait for work, as an accept, that never ends.
void lerta_watch_top_level(LertaPromise *promise) {
  if (promise->state == REJECTED) exit_with_rejection(promise);
  top_level = promise;
  if (promise->state == PENDING) lerta_signals_watch(promise);
}

LERTA_STATIC_STRING(never_settled, "the top-level code awaits a promise that is never settled");

// Its exception has ended the program already, if it threw (see lerta_watch_top_level).
void lerta_finish_top_level(LertaPromise *promise) {
  if (promise->state == PENDING) lerta_exit_with_error(LERTA_STR(never_settled));
  // The promise is released next, and another may take its place.
  top_level = NULL;
}
