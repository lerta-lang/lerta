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

// A socket or a listener. Its libuv handle is replaced when a connect tries the next address, as a
// failed connect leaves it unusable; it is unreferenced but while a read or a wait for a connection
// is pending, so that a socket left open does not keep the program running. Once closed, it is
// freed when the requests that are pending, and the closes of its handles, have ended.
struct LertaTcp {
  uv_tcp_t *handle;
  bool closed;
  int pending;
  // What ends the read, the wait for a connection or the connect that is pending; a close ends it
  // without a call.
  LertaChunkEnd read_end;
  LertaTcpEnd connection_end;
  LertaTcpEnd connect_end;
  void *context;
  // Those that have come and are not taken yet.
  int64_t connections;
  // What a connect resolved, and the address that it tries next.
  struct addrinfo *addresses;
  struct addrinfo *next_address;
  uv_getaddrinfo_t resolving;
  uv_connect_t connecting;
};

static void free_tcp_if_done(LertaTcp *tcp) {
  if (tcp->closed && tcp->pending == 0) free(tcp);
}

static void end_tcp_request(LertaTcp *tcp) {
  tcp->pending--;
  free_tcp_if_done(tcp);
}

static void free_tcp_handle(uv_handle_t *handle) {
  LertaTcp *tcp = handle->data;
  free(handle);
  end_tcp_request(tcp);
}

static void open_tcp_handle(LertaTcp *tcp) {
  tcp->handle = lerta_checked_malloc(sizeof(uv_tcp_t));
  uv_tcp_init(uv_default_loop(), tcp->handle);
  tcp->handle->data = tcp;
  uv_unref((uv_handle_t *)tcp->handle);
}

static void close_tcp_handle(LertaTcp *tcp) {
  tcp->pending++;
  uv_close((uv_handle_t *)tcp->handle, free_tcp_handle);
}

LertaTcp *lerta_loop_tcp_new(void) {
  LertaTcp *tcp = lerta_checked_calloc(1, sizeof(LertaTcp));
  open_tcp_handle(tcp);
  return tcp;
}

void lerta_loop_tcp_close(LertaTcp *tcp) {
  tcp->closed = true;
  tcp->read_end = NULL;
  tcp->connection_end = NULL;
  tcp->connect_end = NULL;
  close_tcp_handle(tcp);
}

static const struct addrinfo tcp_hints = {
  .ai_family = AF_UNSPEC, .ai_socktype = SOCK_STREAM, .ai_flags = AI_NUMERICSERV};

// The port as getaddrinfo takes it, a service named by its number.
static char *port_text(int64_t port, uint8_t buffer[LERTA_INT_TEXT_MAX + 1]) {
  int64_t start = lerta_format_int(port, buffer);
  buffer[LERTA_INT_TEXT_MAX] = '\0';
  return (char *)buffer + start;
}

static int64_t port_of(const struct sockaddr_storage *address) {
  if (address->ss_family == AF_INET6) return ntohs(((struct sockaddr_in6 *)address)->sin6_port);
  return ntohs(((struct sockaddr_in *)address)->sin_port);
}

static void come_connection(uv_stream_t *server, int status) {
  LertaTcp *tcp = server->data;
  if (status == 0) tcp->connections++;
  LertaTcpEnd end = tcp->connection_end;
  if (end == NULL) return;
  lerta_loop_tcp_stop_waiting(tcp);
  end(tcp->context, status == 0);
}

int64_t lerta_loop_tcp_listen(LertaTcp *tcp, const char *host, int64_t port) {
  uint8_t buffer[LERTA_INT_TEXT_MAX + 1];
  uv_getaddrinfo_t request;
  // Without a callback, libuv resolves the name at once.
  int status = uv_getaddrinfo(uv_default_loop(), &request, NULL, host, port_text(port, buffer),
                              &tcp_hints);
  if (status != 0) return -1;
  bool listening = uv_tcp_bind(tcp->handle, request.addrinfo->ai_addr, 0) == 0 &&
                   uv_listen((uv_stream_t *)tcp->handle, SOMAXCONN, come_connection) == 0;
  uv_freeaddrinfo(request.addrinfo);
  struct sockaddr_storage address;
  int length = sizeof(address);
  bool bound =
    listening && uv_tcp_getsockname(tcp->handle, (struct sockaddr *)&address, &length) == 0;
  return bound ? port_of(&address) : -1;
}

bool lerta_loop_tcp_wait_connection(LertaTcp *listener, LertaTcpEnd end, void *context) {
  if (listener->connections > 0) return true;
  listener->connection_end = end;
  listener->context = context;
  uv_ref((uv_handle_t *)listener->handle);
  return false;
}

void lerta_loop_tcp_stop_waiting(LertaTcp *listener) {
  listener->connection_end = NULL;
  uv_unref((uv_handle_t *)listener->handle);
}

bool lerta_loop_tcp_take(LertaTcp *listener, LertaTcp *socket) {
  listener->connections--;
  return uv_accept((uv_stream_t *)listener->handle, (uv_stream_t *)socket->handle) == 0;
}

bool lerta_loop_tcp_peer(LertaTcp *socket, char host[LERTA_HOST_TEXT_SIZE], int64_t *port) {
  struct sockaddr_storage address;
  int length = sizeof(address);
  if (uv_tcp_getpeername(socket->handle, (struct sockaddr *)&address, &length) != 0) return false;
  *port = port_of(&address);
  if (address.ss_family == AF_INET6) {
    return uv_ip6_name((struct sockaddr_in6 *)&address, host, LERTA_HOST_TEXT_SIZE) == 0;
  }
  return uv_ip4_name((struct sockaddr_in *)&address, host, LERTA_HOST_TEXT_SIZE) == 0;
}

static void try_next_address(LertaTcp *tcp);

// A failed connect leaves its socket, of its address's family, on the handle, which libuv would
// connect again to the next address, even of the other family; so each attempt takes a new one.
static void reopen_tcp_handle(LertaTcp *tcp) {
  close_tcp_handle(tcp);
  open_tcp_handle(tcp);
}

static void end_connect(LertaTcp *tcp, bool connected) {
  uv_freeaddrinfo(tcp->addresses);
  tcp->addresses = NULL;
  LertaTcpEnd end = tcp->connect_end;
  tcp->connect_end = NULL;
  end(tcp->context, connected);
}

// A close cancels the attempt, which then ends with UV_ECANCELED.
static void end_connect_attempt(uv_connect_t *request, int status) {
  LertaTcp *tcp = request->data;
  tcp->pending--;
  if (tcp->closed) {
    uv_freeaddrinfo(tcp->addresses);
    free_tcp_if_done(tcp);
  } else if (status == 0) {
    end_connect(tcp, true);
  } else {
    reopen_tcp_handle(tcp);
    try_next_address(tcp);
  }
}

static void try_next_address(LertaTcp *tcp) {
  for (struct addrinfo *address = tcp->next_address; address != NULL; address = address->ai_next) {
    tcp->next_address = address->ai_next;
    tcp->connecting.data = tcp;
    if (uv_tcp_connect(&tcp->connecting, tcp->handle, address->ai_addr, end_connect_attempt) == 0) {
      tcp->pending++;
      return;
    }
    reopen_tcp_handle(tcp);
  }
  end_connect(tcp, false);
}

static void end_resolve(uv_getaddrinfo_t *request, int status, struct addrinfo *addresses) {
  LertaTcp *tcp = request->data;
  tcp->pending--;
  if (tcp->closed) {
    uv_freeaddrinfo(addresses);
    free_tcp_if_done(tcp);
    return;
  }
  tcp->addresses = addresses;
  tcp->next_address = status == 0 ? addresses : NULL;
  try_next_address(tcp);
}

void lerta_loop_tcp_connect(LertaTcp *socket, const char *host, int64_t port, LertaTcpEnd end,
                            void *context) {
  uint8_t buffer[LERTA_INT_TEXT_MAX + 1];
  socket->connect_end = end;
  socket->context = context;
  socket->resolving.data = socket;
  int status = uv_getaddrinfo(uv_default_loop(), &socket->resolving, end_resolve, host,
                              port_text(port, buffer), &tcp_hints);
  if (status == 0) socket->pending++;
  else end_connect(socket, false);
}

static void allocate_chunk(uv_handle_t *handle, size_t suggested_size, uv_buf_t *buffer) {
  (void)handle;
  *buffer = uv_buf_init(lerta_checked_malloc(suggested_size), (unsigned int)suggested_size);
}

// One chunk ends a read; libuv may give 0 bytes, which are none.
static void read_chunk(uv_stream_t *stream, ssize_t count, const uv_buf_t *buffer) {
  LertaTcp *tcp = stream->data;
  if (count == 0) {
    free(buffer->base);
    return;
  }
  LertaChunkEnd end = tcp->read_end;
  lerta_loop_tcp_stop_reading(tcp);
  if (count > 0) {
    end(tcp->context, (uint8_t *)buffer->base, count);
    return;
  }
  free(buffer->base);
  end(tcp->context, NULL, count == UV_EOF ? 0 : -1);
}

void lerta_loop_tcp_read(LertaTcp *socket, LertaChunkEnd end, void *context) {
  if (uv_read_start((uv_stream_t *)socket->handle, allocate_chunk, read_chunk) != 0) {
    end(context, NULL, -1);
    return;
  }
  socket->read_end = end;
  socket->context = context;
  uv_ref((uv_handle_t *)socket->handle);
}

void lerta_loop_tcp_stop_reading(LertaTcp *socket) {
  socket->read_end = NULL;
  uv_read_stop((uv_stream_t *)socket->handle);
  uv_unref((uv_handle_t *)socket->handle);
}

// A buffer's length is an unsigned long on Windows, of 32 bits, so the bytes go in parts of 1 GiB.
enum { TCP_WRITE_PART = 1 << 30 };

typedef struct {
  uv_write_t request;
  LertaTcp *tcp;
  LertaTcpEnd end;
  void *context;
} TcpWrite;

static void end_tcp_write(uv_write_t *request, int status) {
  TcpWrite *write = request->data;
  write->end(write->context, status == 0);
  end_tcp_request(write->tcp);
  free(write);
}

void lerta_loop_tcp_write(LertaTcp *socket, const uint8_t *bytes, int64_t length, LertaTcpEnd end,
                          void *context) {
  // An empty write is one empty buffer, as libuv takes at least one.
  int64_t count = length == 0 ? 1 : (length + TCP_WRITE_PART - 1) / TCP_WRITE_PART;
  uv_buf_t *buffers = lerta_checked_malloc((size_t)count * sizeof(uv_buf_t));
  for (int64_t i = 0; i < count; i++) {
    int64_t part = length - i * TCP_WRITE_PART;
    if (part > TCP_WRITE_PART) part = TCP_WRITE_PART;
    buffers[i] = uv_buf_init((char *)bytes + i * TCP_WRITE_PART, (unsigned int)part);
  }
  TcpWrite *write = lerta_checked_malloc(sizeof(TcpWrite));
  *write = (TcpWrite){.tcp = socket, .end = end, .context = context};
  write->request.data = write;
  // libuv copies the buffers, but not the bytes.
  int status = uv_write(&write->request, (uv_stream_t *)socket->handle, buffers,
                        (unsigned int)count, end_tcp_write);
  free(buffers);
  if (status == 0) {
    socket->pending++;
    return;
  }
  free(write);
  end(context, false);
}

static void end_shutdown(uv_shutdown_t *request, int status) {
  (void)status;
  LertaTcp *tcp = request->data;
  free(request);
  end_tcp_request(tcp);
}

void lerta_loop_tcp_shutdown(LertaTcp *socket) {
  uv_shutdown_t *request = lerta_checked_malloc(sizeof(uv_shutdown_t));
  request->data = socket;
  if (uv_shutdown(request, (uv_stream_t *)socket->handle, end_shutdown) == 0) socket->pending++;
  else free(request);
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
