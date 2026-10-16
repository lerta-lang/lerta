#include <stdlib.h>

#include <uv.h>

#include "internal.h"

// See docs/internals.md#functions-that-await.

typedef struct {
  uv_timer_t handle;
  LertaPromise *promise;
} SleepTimer;

static void free_sleep(uv_handle_t *handle) {
  free(handle->data);
}

// The sleep holds its promise until it resolves it.
static void end_sleep(uv_timer_t *handle) {
  SleepTimer *timer = handle->data;
  lerta_promise_resolve(timer->promise);
  lerta_release(timer->promise);
  uv_close((uv_handle_t *)handle, free_sleep);
}

void lerta_loop_resolve_after(uint64_t milliseconds, LertaPromise *promise) {
  SleepTimer *timer = lerta_checked_malloc(sizeof(SleepTimer));
  timer->promise = promise;
  timer->handle.data = timer;
  lerta_retain(promise);
  uv_loop_t *loop = uv_default_loop();
  uv_timer_init(loop, &timer->handle);
  // libuv counts from the time it last read, as it ran; the program may have run long since.
  uv_update_time(loop);
  uv_timer_start(&timer->handle, end_sleep, milliseconds, 0);
}

// stdin is read with blocking reads on a thread of its own, as Deno and Go read it, rather than as
// a libuv stream, which would make descriptor 0 non-blocking for the programs that share it, and
// rather than on the thread pool, whose few threads a read that waits for input would hold.
enum { STDIN_CHUNK_SIZE = 65536 };

static uv_thread_t stdin_thread;
static uv_async_t stdin_done;
static uv_mutex_t stdin_mutex;
static uv_cond_t stdin_wanted;
static bool stdin_started = false;
// Set by the loop to ask for a chunk, and cleared by the thread with the chunk, under the mutex.
static bool stdin_requested = false;
static uint8_t *stdin_bytes;
static int64_t stdin_length;
// The read that the loop waits for; it holds stdin_done referenced meanwhile.
static bool stdin_pending = false;
static LertaChunkEnd stdin_end;
static void *stdin_context;

// The thread touches only what the mutex guards, and the bytes it allocates with malloc.
static void read_stdin_chunks(void *unused) {
  (void)unused;
  for (;;) {
    uv_mutex_lock(&stdin_mutex);
    while (!stdin_requested) uv_cond_wait(&stdin_wanted, &stdin_mutex);
    uv_mutex_unlock(&stdin_mutex);
    uint8_t *bytes = malloc(STDIN_CHUNK_SIZE);
    int64_t length =
        bytes == NULL ? LERTA_OUT_OF_MEMORY : lerta_os_read_stdin(bytes, STDIN_CHUNK_SIZE);
    if (length <= 0) {
      free(bytes);
      bytes = NULL;
    }
    uv_mutex_lock(&stdin_mutex);
    stdin_bytes = bytes;
    stdin_length = length;
    stdin_requested = false;
    uv_mutex_unlock(&stdin_mutex);
    uv_async_send(&stdin_done);
  }
}

// Each request makes one send, so the callback always has the chunk that the request asked for.
static void end_stdin_read(uv_async_t *handle) {
  uv_mutex_lock(&stdin_mutex);
  uint8_t *bytes = stdin_bytes;
  int64_t length = stdin_length;
  uv_mutex_unlock(&stdin_mutex);
  stdin_pending = false;
  uv_unref((uv_handle_t *)handle);
  stdin_end(stdin_context, bytes, length);
}

static void start_stdin_thread(void) {
  stdin_started = true;
  uv_mutex_init(&stdin_mutex);
  uv_cond_init(&stdin_wanted);
  uv_async_init(uv_default_loop(), &stdin_done, end_stdin_read);
  uv_unref((uv_handle_t *)&stdin_done);
  if (uv_thread_create(&stdin_thread, read_stdin_chunks, NULL) != 0) {
    lerta_panic("cannot start the thread that reads stdin");
  }
}

void lerta_loop_read_stdin(LertaChunkEnd end, void *context) {
  if (!stdin_started) start_stdin_thread();
  if (stdin_pending) lerta_panic("stdin is read again before its read ends");
  stdin_pending = true;
  stdin_end = end;
  stdin_context = context;
  uv_ref((uv_handle_t *)&stdin_done);
  uv_mutex_lock(&stdin_mutex);
  stdin_requested = true;
  uv_cond_signal(&stdin_wanted);
  uv_mutex_unlock(&stdin_mutex);
}

// A program that runs, and the output it writes to the pipe, if it is read, which ends with it.
typedef struct {
  uv_process_t process;
  uv_pipe_t pipe;
  bool reads_output;
  bool exited;
  bool output_ended;
  int64_t exit_code;
  uint8_t *output;
  size_t output_length;
  size_t output_capacity;
  bool output_failed;
  int open_handles;
  LertaProgramEnd end;
  void *context;
} RunningProgram;

static void free_program(uv_handle_t *handle) {
  RunningProgram *program = handle->data;
  if (--program->open_handles > 0) return;
  free(program->output);
  free(program);
}

// Once the program has exited and its output, if read, has ended.
static void end_program_if_done(RunningProgram *program) {
  if (!program->exited || (program->reads_output && !program->output_ended)) return;
  LertaString *output = NULL;
  if (program->reads_output && !program->output_failed) {
    const char *bytes = (const char *)program->output;
    output = lerta_string_from_bytes(bytes, (int64_t)program->output_length);
  }
  program->end(program->context, program->exit_code, output);
  uv_close((uv_handle_t *)&program->process, free_program);
  if (program->reads_output) uv_close((uv_handle_t *)&program->pipe, free_program);
}

static void exit_program(uv_process_t *process, int64_t exit_status, int term_signal) {
  RunningProgram *program = process->data;
  program->exited = true;
  program->exit_code = term_signal != 0 ? 128 + term_signal : exit_status;
  end_program_if_done(program);
}

static void allocate_output(uv_handle_t *handle, size_t suggested_size, uv_buf_t *buffer) {
  RunningProgram *program = handle->data;
  if (program->output_capacity - program->output_length < suggested_size) {
    program->output_capacity = 2 * program->output_capacity + suggested_size;
    program->output = lerta_checked_realloc(program->output, program->output_capacity);
  }
  *buffer = uv_buf_init((char *)program->output + program->output_length,
                        (unsigned int)(program->output_capacity - program->output_length));
}

static void read_output(uv_stream_t *stream, ssize_t count, const uv_buf_t *buffer) {
  (void)buffer;
  RunningProgram *program = stream->data;
  if (count > 0) program->output_length += (size_t)count;
  if (count >= 0) return;
  program->output_failed = count != UV_EOF;
  program->output_ended = true;
  uv_read_stop(stream);
  end_program_if_done(program);
}

bool lerta_loop_run_program(char *file, char **args, bool reads_output, LertaProgramEnd end,
                            void *context) {
  uv_loop_t *loop = uv_default_loop();
  RunningProgram *program = lerta_checked_calloc(1, sizeof(RunningProgram));
  program->reads_output = reads_output;
  program->end = end;
  program->context = context;
  program->process.data = program;
  program->pipe.data = program;
  uv_stdio_container_t stdio[3] = {
    {.flags = UV_INHERIT_FD, .data.fd = 0},
    {.flags = UV_INHERIT_FD, .data.fd = 1},
    {.flags = UV_INHERIT_FD, .data.fd = 2},
  };
  if (reads_output) {
    uv_pipe_init(loop, &program->pipe, 0);
    program->open_handles++;
    stdio[1] = (uv_stdio_container_t){.flags = UV_CREATE_PIPE | UV_WRITABLE_PIPE,
                                      .data.stream = (uv_stream_t *)&program->pipe};
  }
  // On Windows, the arguments come quoted (see lerta_os_program_argument) and the file found;
  // libuv would quote them its own way and search the current directory first.
  uv_process_options_t options = {
    .exit_cb = exit_program,
    .file = file,
    .args = args,
    .flags = UV_PROCESS_WINDOWS_VERBATIM_ARGUMENTS | UV_PROCESS_WINDOWS_FILE_PATH_EXACT_NAME,
    .stdio_count = 3,
    .stdio = stdio,
  };
  // A failed spawn still has its handle closed, as libuv asks.
  program->open_handles++;
  bool spawned = uv_spawn(loop, &program->process, &options) == 0;
  if (spawned && reads_output) {
    uv_read_start((uv_stream_t *)&program->pipe, allocate_output, read_output);
  }
  if (!spawned) {
    uv_close((uv_handle_t *)&program->process, free_program);
    if (reads_output) uv_close((uv_handle_t *)&program->pipe, free_program);
  }
  return spawned;
}

bool lerta_loop_wait(void) {
  uv_loop_t *loop = uv_default_loop();
  if (!uv_loop_alive(loop)) return false;
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
