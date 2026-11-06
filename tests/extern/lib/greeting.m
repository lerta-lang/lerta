// The Objective-C side of greeting.lerta, which test/cli/extern.lerta links with it on macOS: it
// makes a String through the runtime's header, which the build finds for it.
#include "lerta.h"

LertaString *greeting(void) {
  return lerta_string_from_bytes("hello", 5);
}
