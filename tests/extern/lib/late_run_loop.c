// The C side of late_run_loop.lerta, which test/cli/extern.lerta links with it, but not with
// CoreFoundation: it loads another library, then CoreFoundation itself, as a framework opened with
// dlopen would, and posts a block to the main dispatch queue, which only the main run loop runs.
#include <dispatch/dispatch.h>
#include <dlfcn.h>
#include <stdint.h>

static int64_t ran = 0;

void load_other(void) { dlopen("/usr/lib/libz.1.dylib", RTLD_NOW); }

void load_and_post(void) {
  dlopen("/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation", RTLD_NOW);
  dispatch_async(dispatch_get_main_queue(), ^{ ran = 1; });
}

int64_t block_ran(void) { return ran; }
