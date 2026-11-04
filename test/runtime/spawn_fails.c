// libuv 1.53.0 took the handle of a spawn that failed while it made the stdio off the loop's queue,
// and uv_close, which its docs ask for even then, took it off again: with a handle made in between,
// the loop never ended (see docs/internals/platforms.md#libuv). A TCP handle given as a pipe to
// make makes uv_spawn fail there.
#include <stdio.h>
#include <uv.h>
#include "lerta.h"

static void count(uv_handle_t *handle, void *walked) {
  (void)handle;
  (*(int *)walked)++;
}

void lerta_main(void) {
  uv_loop_t *loop = uv_default_loop();
  uv_timer_t before, after;
  uv_tcp_t not_a_pipe;
  uv_process_t process;
  uv_timer_init(loop, &before);
  uv_tcp_init(loop, &not_a_pipe);
  char *args[] = {"true", NULL};
  uv_stdio_container_t stdio[2] = {
    {.flags = UV_IGNORE},
    {.flags = UV_CREATE_PIPE | UV_WRITABLE_PIPE, .data.stream = (uv_stream_t *)&not_a_pipe},
  };
  uv_process_options_t options = {.file = "true", .args = args, .stdio_count = 2, .stdio = stdio};
  printf("%s\n", uv_err_name(uv_spawn(loop, &process, &options)));
  uv_close((uv_handle_t *)&process, NULL);
  uv_timer_init(loop, &after);
  uv_close((uv_handle_t *)&not_a_pipe, NULL);
  uv_run(loop, UV_RUN_DEFAULT);
  int walked = 0;
  uv_walk(loop, count, &walked);
  printf("%d\n", walked);
  uv_close((uv_handle_t *)&before, NULL);
  uv_close((uv_handle_t *)&after, NULL);
  uv_run(loop, UV_RUN_DEFAULT);
  printf("%d\n", uv_loop_close(loop));
  fflush(stdout);
}
