// Writes to stdout, then stderr, then stdout, through Writers; with EXIT_AT_ONCE, it then ends at
// once, before the buffer is written out.
#include <unistd.h>
#include "lerta.h"

void lerta_main(void) {
  LERTA_STATIC_STRING(first, "first\n");
  LERTA_STATIC_STRING(second, "second\n");
  LERTA_STATIC_STRING(third, "third\n");
  lerta_release(lerta_stream_write(1, LERTA_STR(first)));
  lerta_release(lerta_stream_write(2, LERTA_STR(second)));
  lerta_release(lerta_stream_write(1, LERTA_STR(third)));
#ifdef EXIT_AT_ONCE
  _exit(0);
#endif
}
