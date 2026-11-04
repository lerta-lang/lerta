#include <stdlib.h>

#include <uv.h>

#include "internal.h"

// See docs/internals/iteration.md#functions-that-await.

bool lerta_loop_wait(void) {
  uv_loop_t *loop = uv_default_loop();
  if (!uv_loop_alive(loop)) return false;
  uv_run(loop, UV_RUN_ONCE);
  return true;
}

typedef struct {
  uv_work_t request;
  void *data;
  void (*work)(void *data);
  void (*done)(void *data);
} Work;

static void run_work(uv_work_t *request) {
  Work *work = request->data;
  work->work(work->data);
}

static void end_work(uv_work_t *request, int status) {
  (void)status;
  Work *work = request->data;
  work->done(work->data);
  free(work);
}

void lerta_loop_work(void *data, void (*work)(void *data), void (*done)(void *data)) {
  Work *queued = lerta_checked_malloc(sizeof(Work));
  *queued = (Work){.data = data, .work = work, .done = done};
  queued->request.data = queued;
  uv_queue_work(uv_default_loop(), &queued->request, run_work, end_work);
}
