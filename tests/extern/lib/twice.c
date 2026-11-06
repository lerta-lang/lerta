// The C side of twice.lerta, which test/cli/extern.lerta links with it.
#include <stdint.h>

int64_t twice(int64_t n) {
  return 2 * n;
}
