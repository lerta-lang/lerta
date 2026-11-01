// Holds every thread of libuv's pool with reads of a FIFO that no one writes, and then writes out
// stdout and prints: the output does not wait for the pool, and the program ends at once.
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>
#include "internal.h"

// More than the pool's threads, whose number is set before libuv starts the pool with the first
// read, and more than its default, 4, should the pool have started before.
enum { POOL_SIZE = 4, READS = 8 };

void lerta_main(void) {
  char size[8];
  snprintf(size, sizeof size, "%d", POOL_SIZE);
  setenv("UV_THREADPOOL_SIZE", size, 1);
  const char *tmp = getenv("TMPDIR");
  char dir[1024];
  snprintf(dir, sizeof dir, "%s/lerta-busy-pool-XXXXXX", tmp != NULL && *tmp ? tmp : "/tmp");
  if (mkdtemp(dir) == NULL) abort();
  char path[sizeof dir + 8];
  snprintf(path, sizeof path, "%s/fifo", dir);
  if (mkfifo(path, 0600) != 0) abort();
  LertaString *name = lerta_string_from_bytes((const uint8_t *)path, (int64_t)strlen(path));
  for (int i = 0; i < READS; i++) lerta_release(lerta_read_file_async(name));
  LERTA_STATIC_STRING(flushed, "flushed\n");
  LERTA_STATIC_STRING(printed, "printed\n");
  lerta_release(lerta_stream_write(1, LERTA_STR(flushed)));
  lerta_release(lerta_stream_flush(1));
  lerta_print_stdout(LERTA_STR(printed));
  unlink(path);
  rmdir(dir);
  // The reads hold the loop, which would wait for them.
  lerta_output_flush_at_end(false);
  _exit(0);
}
