// The Objective-C side of main_run_loop.lerta, which test/cli/extern.lerta links with it and with
// CoreFoundation: what Apple's frameworks have the main thread's run loop run.
#include <CoreFoundation/CoreFoundation.h>
#include <dispatch/dispatch.h>
#include <pthread.h>
#include <stdint.h>

enum { BLOCK_RAN = 1, TIMER_FIRED = 2, OFF_MAIN_THREAD = 4 };

static int64_t ran = 0;

static void record(int64_t what) { ran |= pthread_main_np() ? what : OFF_MAIN_THREAD; }

void schedule_on_main(void) {
  dispatch_async(dispatch_get_main_queue(), ^{ record(BLOCK_RAN); });
  CFRunLoopTimerRef timer = CFRunLoopTimerCreateWithHandler(
      NULL, CFAbsoluteTimeGetCurrent() + 0.05, 0, 0, 0,
      ^(CFRunLoopTimerRef fired) { (void)fired, record(TIMER_FIRED); });
  CFRunLoopAddTimer(CFRunLoopGetMain(), timer, kCFRunLoopDefaultMode);
  CFRelease(timer);
  // Left on the run loop, which does not keep the program running.
  CFRunLoopTimerRef repeating = CFRunLoopTimerCreateWithHandler(
      NULL, CFAbsoluteTimeGetCurrent() + 0.01, 0.01, 0, 0,
      ^(CFRunLoopTimerRef fired) { (void)fired; });
  CFRunLoopAddTimer(CFRunLoopGetMain(), repeating, kCFRunLoopDefaultMode);
  CFRelease(repeating);
}

int64_t ran_on_main(void) { return ran; }
