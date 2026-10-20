// The C side of dirty_nil.lerta, which test/cli.lerta links with it: a nil that holds a value.
#include "../../../runtime/lerta.h"

LertaOptionalInt dirty_nil(int64_t value) {
  return (LertaOptionalInt){ .present = false, .value = value };
}
