#include <signal.h>
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

static void cancel_sleep(void *context) {
  SleepTimer *timer = context;
  uv_timer_stop(&timer->handle);
  lerta_promise_reject_cancelled(timer->promise);
  lerta_release(timer->promise);
  uv_close((uv_handle_t *)&timer->handle, free_sleep);
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
  lerta_promise_on_cancel(promise, cancel_sleep, timer);
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

void lerta_loop_hold_stdin(bool held) {
  if (held) uv_ref((uv_handle_t *)&stdin_done);
  else uv_unref((uv_handle_t *)&stdin_done);
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

// A stream of a program that runs which is read into a buffer until it ends.
typedef struct {
  uv_pipe_t pipe;
  bool is_read;
  bool ended;
  bool failed;
  uint8_t *bytes;
  size_t length;
  size_t capacity;
} ProgramOutput;

// A program that runs, its standard output and error, of which those that are read, and the timer
// that kills it once a stop has waited long enough. Each handle's data is the program.
struct LertaRunningProgram {
  uv_process_t process;
  ProgramOutput outputs[2];
  uv_timer_t kill_timer;
  uint64_t kill_after;
  int64_t output_limit;
  bool too_long;
  bool stopping;
  bool exited;
  int64_t status;
  int open_handles;
  LertaProgramEnd end;
  void *context;
};

static void free_program(uv_handle_t *handle) {
  LertaRunningProgram *program = handle->data;
  if (--program->open_handles > 0) return;
  for (int i = 0; i < 2; i++) free(program->outputs[i].bytes);
  free(program);
}

static void close_handle(void *handle) {
  uv_close((uv_handle_t *)handle, free_program);
}

// The bytes that were read, owned, or NULL if the stream is not read or its read failed.
static LertaString *output_text(const ProgramOutput *output) {
  if (!output->is_read || output->failed) return NULL;
  return lerta_string_from_bytes((const char *)output->bytes, (int64_t)output->length);
}

static void stop_reading(ProgramOutput *output) {
  if (!output->is_read || output->ended) return;
  output->ended = true;
  uv_read_stop((uv_stream_t *)&output->pipe);
}

// Once the program has exited and the streams that are read have ended.
static void end_program_if_done(LertaRunningProgram *program) {
  if (!program->exited) return;
  for (int i = 0; i < 2; i++) {
    if (program->outputs[i].is_read && !program->outputs[i].ended) return;
  }
  LertaString *output = output_text(&program->outputs[0]);
  LertaString *errors = output_text(&program->outputs[1]);
  program->end(program->context, program->status, output, errors, program->too_long);
  if (program->stopping) close_handle(&program->kill_timer);
  close_handle(&program->process);
  for (int i = 0; i < 2; i++) {
    if (program->outputs[i].is_read) close_handle(&program->outputs[i].pipe);
  }
}

// A stopped program's output is not wanted, and a program that it started may hold its pipes
// open, so they are not waited for.
static void exit_program(uv_process_t *process, int64_t exit_status, int term_signal) {
  LertaRunningProgram *program = process->data;
  program->exited = true;
  program->status = term_signal != 0 ? -term_signal : exit_status;
  if (program->stopping) {
    uv_timer_stop(&program->kill_timer);
    for (int i = 0; i < 2; i++) stop_reading(&program->outputs[i]);
  }
  end_program_if_done(program);
}

static ProgramOutput *output_of(uv_handle_t *handle) {
  LertaRunningProgram *program = handle->data;
  bool is_output = handle == (uv_handle_t *)&program->outputs[0].pipe;
  return &program->outputs[is_output ? 0 : 1];
}

static void allocate_output(uv_handle_t *handle, size_t suggested_size, uv_buf_t *buffer) {
  ProgramOutput *output = output_of(handle);
  if (output->capacity - output->length < suggested_size) {
    output->capacity = 2 * output->capacity + suggested_size;
    output->bytes = lerta_checked_realloc(output->bytes, output->capacity);
  }
  *buffer = uv_buf_init((char *)output->bytes + output->length,
                        (unsigned int)(output->capacity - output->length));
}

// Output past the limit stops the program, as a cancel does, and the output, which is dropped, is
// read no more, so that a program that does not stop at once cannot fill the memory meanwhile.
static void read_output(uv_stream_t *stream, ssize_t count, const uv_buf_t *buffer) {
  (void)buffer;
  LertaRunningProgram *program = stream->data;
  ProgramOutput *output = output_of((uv_handle_t *)stream);
  if (count > 0) output->length += (size_t)count;
  bool is_too_long = program->output_limit >= 0 && output->length > (size_t)program->output_limit;
  if (is_too_long && !program->too_long) {
    program->too_long = true;
    for (int i = 0; i < 2; i++) stop_reading(&program->outputs[i]);
    lerta_loop_stop_program(program);
  }
  if (count >= 0) return;
  output->failed = count != UV_EOF;
  stop_reading(output);
  end_program_if_done(stream->data);
}

LertaRunningProgram *lerta_loop_run_program(const LertaProgramSpec *spec, LertaProgramEnd end,
                                            void *context) {
  uv_loop_t *loop = uv_default_loop();
  LertaRunningProgram *program = lerta_checked_calloc(1, sizeof(LertaRunningProgram));
  program->end = end;
  program->context = context;
  program->kill_after = spec->kill_after;
  program->output_limit = spec->output_limit;
  program->process.data = program;
  int stdin_fd = spec->stdin_fd >= 0 ? spec->stdin_fd : 0;
  uv_stdio_container_t stdio[3] = {
    {.flags = UV_INHERIT_FD, .data.fd = stdin_fd},
    {.flags = UV_INHERIT_FD, .data.fd = 1},
    {.flags = UV_INHERIT_FD, .data.fd = 2},
  };
  for (int i = 0; i < 2; i++) {
    if (!spec->reads[i]) continue;
    ProgramOutput *output = &program->outputs[i];
    output->is_read = true;
    uv_pipe_init(loop, &output->pipe, 0);
    output->pipe.data = program;
    program->open_handles++;
    stdio[i + 1] = (uv_stdio_container_t){.flags = UV_CREATE_PIPE | UV_WRITABLE_PIPE,
                                          .data.stream = (uv_stream_t *)&output->pipe};
  }
  // On Windows, the file comes found (see lerta_os_program_file), and libuv quotes the arguments.
  uv_process_options_t options = {
    .exit_cb = exit_program,
    .file = spec->file,
    .args = spec->args,
    .env = spec->env,
    .cwd = spec->cwd,
    .flags = UV_PROCESS_WINDOWS_FILE_PATH_EXACT_NAME,
    .stdio_count = 3,
    .stdio = stdio,
  };
  // A failed spawn still has its handle closed, as libuv asks.
  program->open_handles++;
  bool spawned = uv_spawn(loop, &program->process, &options) == 0;
  for (int i = 0; i < 2; i++) {
    ProgramOutput *output = &program->outputs[i];
    if (!output->is_read) continue;
    if (spawned) uv_read_start((uv_stream_t *)&output->pipe, allocate_output, read_output);
    else close_handle(&output->pipe);
  }
  if (spawned) return program;
  close_handle(&program->process);
  return NULL;
}

static void kill_program(uv_timer_t *timer) {
  LertaRunningProgram *program = timer->data;
  uv_process_kill(&program->process, SIGKILL);
}

// SIGTERM lets the program end as it chooses, and SIGKILL ends it if it does not in time. On
// Windows, either one terminates it at once. A program that has exited already has only its
// output left, which is not waited for, as at its exit after a stop.
void lerta_loop_stop_program(LertaRunningProgram *program) {
  if (program->stopping) return;
  if (program->exited) {
    for (int i = 0; i < 2; i++) stop_reading(&program->outputs[i]);
    end_program_if_done(program);
    return;
  }
  program->stopping = true;
  uv_timer_init(uv_default_loop(), &program->kill_timer);
  program->kill_timer.data = program;
  program->open_handles++;
  uv_process_kill(&program->process, SIGTERM);
  uv_timer_start(&program->kill_timer, kill_program, program->kill_after, 0);
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
