#include <stdlib.h>

#include <uv.h>

#include "internal.h"

#ifdef __APPLE__
#include <dlfcn.h>

#include <CoreFoundation/CoreFoundation.h>

// See docs/internals/iteration.md#the-main-run-loop. CoreFoundation is called through dlsym, as
// linking it would cost every program's start.
static struct {
  CFRunLoopRef (*get_main)(void);
  CFFileDescriptorRef (*create_descriptor)(CFAllocatorRef, CFFileDescriptorNativeDescriptor,
                                           Boolean, CFFileDescriptorCallBack,
                                           const CFFileDescriptorContext *);
  void (*enable_callbacks)(CFFileDescriptorRef, CFOptionFlags);
  CFRunLoopSourceRef (*create_source)(CFAllocatorRef, CFFileDescriptorRef, CFIndex);
  void (*add_source)(CFRunLoopRef, CFRunLoopSourceRef, CFRunLoopMode);
  SInt32 (*run_in_mode)(CFRunLoopMode, CFTimeInterval, Boolean);
  CFRunLoopMode mode;
  CFFileDescriptorRef loop_descriptor;
} run_loop;

// Called only to end the run loop's wait. The descriptor's callbacks are disabled once called,
// and enabled again before each wait.
static void on_loop_ready(CFFileDescriptorRef descriptor, CFOptionFlags types, void *info) {
  (void)descriptor, (void)types, (void)info;
}

static bool load_run_loop(void *library) {
  run_loop.get_main = dlsym(library, "CFRunLoopGetMain");
  run_loop.create_descriptor = dlsym(library, "CFFileDescriptorCreate");
  run_loop.enable_callbacks = dlsym(library, "CFFileDescriptorEnableCallBacks");
  run_loop.create_source = dlsym(library, "CFFileDescriptorCreateRunLoopSource");
  run_loop.add_source = dlsym(library, "CFRunLoopAddSource");
  run_loop.run_in_mode = dlsym(library, "CFRunLoopRunInMode");
  CFRunLoopMode *mode = dlsym(library, "kCFRunLoopDefaultMode");
  if (!run_loop.get_main || !run_loop.create_descriptor || !run_loop.enable_callbacks ||
      !run_loop.create_source || !run_loop.add_source || !run_loop.run_in_mode || !mode) {
    return false;
  }
  run_loop.mode = *mode;
  run_loop.loop_descriptor = run_loop.create_descriptor(NULL, uv_backend_fd(uv_default_loop()),
                                                        false, on_loop_ready, NULL);
  // Kept, as the program waits on it until it ends.
  CFRunLoopSourceRef source = run_loop.create_source(NULL, run_loop.loop_descriptor, 0);
  run_loop.add_source(run_loop.get_main(), source, run_loop.mode);
  return true;
}

// Only a program that links CoreFoundation, as Apple's frameworks do, can use the main run loop.
// Checked at the first wait, by which time the linked frameworks are loaded.
static bool uses_run_loop(void) {
  static enum { UNKNOWN, NO, YES } uses = UNKNOWN;
  if (uses == UNKNOWN) {
    void *library =
        dlopen("/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation", RTLD_NOLOAD);
    uses = library && load_run_loop(library) ? YES : NO;
  }
  return uses == YES;
}

// Waits on the main run loop, running what is due on it meanwhile, until libuv's descriptor is
// ready or its next timer is due, then runs libuv once without waiting.
static void wait_in_run_loop(uv_loop_t *loop) {
  // What CFRunLoopRun itself waits for as long as it takes.
  const CFTimeInterval forever = 1.0e10;
  int timeout = uv_backend_timeout(loop);
  run_loop.enable_callbacks(run_loop.loop_descriptor, kCFFileDescriptorReadCallBack);
  run_loop.run_in_mode(run_loop.mode, timeout < 0 ? forever : timeout / 1000.0, true);
  uv_run(loop, UV_RUN_NOWAIT);
}
#endif

// See docs/internals/iteration.md#functions-that-await.

bool lerta_loop_wait(void) {
  uv_loop_t *loop = uv_default_loop();
  if (!uv_loop_alive(loop)) return false;
#ifdef __APPLE__
  if (uses_run_loop()) {
    wait_in_run_loop(loop);
    return true;
  }
#endif
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
