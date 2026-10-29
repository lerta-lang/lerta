// Fails a write to stderr, made read-only, and then writes again to stderr as it was: a stream that
// has failed takes no more, whether print_error or a write of std:io's stderr failed
// (FAIL_BY_WRITE), so the later print_error is dropped, or a write comes after (DROP_BY_WRITE),
// which is rejected.
#include <fcntl.h>
#include <stdlib.h>
#include <unistd.h>
#include "internal.h"

LERTA_STATIC_STRING(lost, "lost\n");
LERTA_STATIC_STRING(dropped, "dropped\n");

static void fail(void) {
#ifdef FAIL_BY_WRITE
  lerta_release(lerta_stream_write(2, (const LertaString *)&lost));
  lerta_output_flush();
#else
  lerta_print_stderr((const LertaString *)&lost);
#endif
}

static void drop(void) {
#ifdef DROP_BY_WRITE
  lerta_release(lerta_stream_write(2, (const LertaString *)&dropped));
#else
  lerta_print_stderr((const LertaString *)&dropped);
#endif
}

void lerta_main(void) {
  int saved = dup(2);
  int read_only = open("/dev/null", O_RDONLY);
  if (saved < 0 || read_only < 0) abort();
  dup2(read_only, 2);
  close(read_only);
  fail();
  dup2(saved, 2);
  close(saved);
  drop();
}
