#include <signal.h>
#include <stdlib.h>
#include <string.h>

#include <uv.h>

#include "internal.h"

LERTA_STATIC_STRING(cannot_make_pipe, "cannot make a pipe");

static int argument_count = 0;
static char **arguments = NULL;

void lerta_set_arguments(int argc, char **argv) {
  lerta_os_arguments(&argc, &argv);
  argument_count = argc;
  arguments = argv;
}

LertaArray *lerta_argv(void) {
  LertaArray *result = lerta_array_create(LERTA_REFERENCE_ITEMS);
  for (int i = 1; i < argument_count; i++) {
    LertaString *argument = lerta_string_from_c(arguments[i]);
    lerta_array_append(result, &argument);
    lerta_release(argument);
  }
  return result;
}

// An empty Binary if the program was started with no arguments at all.
LertaString *lerta_program_path(void) {
  return lerta_string_from_c(argument_count > 0 ? arguments[0] : "");
}

// std:process checks that the code is from 0 to 255.
void lerta_exit(int64_t code) {
  bool flushed = lerta_output_flush_at_end(false);
  if (lerta_report_unreachable()) lerta_os_exit(LERTA_LEAK_EXIT_CODE);
  lerta_os_exit(flushed || code != 0 ? (int)code : 1);
}

static char *c_string_item(const LertaArray *strings, int64_t index) {
  return lerta_c_string((const LertaString *)(intptr_t)lerta_word_item(strings, index));
}

static void free_c_strings(char **c_strings) {
  for (char **string = c_strings; *string != NULL; string++) free(*string);
  free(c_strings);
}

// The strings as C strings, ending with NULL, which free_c_strings frees.
static char **c_strings_of(const LertaArray *strings) {
  char **c_strings = lerta_checked_calloc((size_t)strings->length + 1, sizeof(char *));
  for (int64_t i = 0; i < strings->length; i++) {
    c_strings[i] = c_string_item(strings, i);
  }
  return c_strings;
}

// A program that runs, and the timer that kills it once a stop has waited long enough; each
// handle's data is the program. It is freed once std:process has freed it and its handles are
// closed, which they are once it has exited.
typedef struct {
  uv_process_t process;
  uv_timer_t kill_timer;
  uint64_t kill_after;
  bool stopping;
  bool exited;
  bool freed;
  int64_t status;
  int open_handles;
  // The promise of the wait, which it holds, and whether a cancel has gone through it.
  LertaPromise *waiting;
  bool cancelled;
} Program;

static Program *program_of(int64_t pointer) {
  return (Program *)(intptr_t)pointer;
}

static void free_program_if_done(Program *program) {
  if (program->freed && program->open_handles == 0) free(program);
}

static void end_handle(uv_handle_t *handle) {
  Program *program = handle->data;
  program->open_handles--;
  free_program_if_done(program);
}

static void close_handle(void *handle) {
  uv_close((uv_handle_t *)handle, end_handle);
}

// A cancelled wait is rejected once the program has ended, as its stop asked.
static void settle_wait(Program *program) {
  LertaPromise *promise = program->waiting;
  program->waiting = NULL;
  if (program->cancelled) {
    lerta_promise_reject_cancelled(promise);
  } else {
    *(int64_t *)lerta_promise_slot(promise) = program->status;
    lerta_promise_resolve(promise);
  }
  lerta_release(promise);
}

static void exit_program(uv_process_t *process, int64_t exit_status, int term_signal) {
  Program *program = process->data;
  program->exited = true;
  program->status = term_signal != 0 ? -term_signal : exit_status;
  if (program->stopping) {
    uv_timer_stop(&program->kill_timer);
    close_handle(&program->kill_timer);
  }
  close_handle(&program->process);
  if (program->waiting != NULL) settle_wait(program);
}

static void kill_program(uv_timer_t *timer) {
  Program *program = timer->data;
  uv_process_kill(&program->process, SIGKILL);
}

// SIGTERM lets the program end as it chooses, and SIGKILL ends it if it does not in time. On
// Windows, either one terminates it at once.
void lerta_program_stop(int64_t pointer) {
  Program *program = program_of(pointer);
  if (program->stopping || program->exited) return;
  program->stopping = true;
  uv_timer_init(uv_default_loop(), &program->kill_timer);
  program->kill_timer.data = program;
  program->open_handles++;
  uv_process_kill(&program->process, SIGTERM);
  uv_timer_start(&program->kill_timer, kill_program, program->kill_after, 0);
}

// The streams that std:process gives for a DISCARD and for errors sent as STDOUT, the values of
// DISCARDED and AS_STDOUT in std/process.lerta.
enum { DISCARDED_STREAM = 1, AS_STDOUT_STREAM = 2 };

// A pipe of the system for the stream of a handle, rather than the pipes that libuv makes for a
// program, which are sockets on Unix, which some programs tell apart, as `script` does by its
// stdin: the program's end, which it inherits, in `child`, and this program's, which the handle
// opens, without blocking, as libuv's streams on Windows need. A handle of 0 is this program's own
// stream, and `child` is -1 then. A negative one is a file of a system pipe that Lerta holds, as
// -1 minus it, which the program inherits as it is, and which is left to Lerta to close.
// DISCARDED_STREAM and AS_STDOUT_STREAM, which no handle's address is, take no pipe (see spawn).
static bool open_pipe(int64_t handle, bool program_reads, uv_file *child, bool *made) {
  *child = -1;
  *made = false;
  if (handle == 0 || handle == DISCARDED_STREAM || handle == AS_STDOUT_STREAM) return true;
  if (handle < 0) {
    *child = (uv_file)(-1 - handle);
    return true;
  }
  uv_file files[2];
  int read_flags = program_reads ? 0 : UV_NONBLOCK_PIPE;
  int write_flags = program_reads ? UV_NONBLOCK_PIPE : 0;
  if (uv_pipe(files, read_flags, write_flags) != 0) return false;
  uv_file own = program_reads ? files[1] : files[0];
  if (uv_pipe_open((uv_pipe_t *)lerta_handle_stream(handle), own) != 0) {
    lerta_os_close(files[0]);
    lerta_os_close(files[1]);
    return false;
  }
  *child = program_reads ? files[0] : files[1];
  *made = true;
  return true;
}

// Starts the program; on Windows, the file comes found (see lerta_os_program_file), and libuv
// quotes the arguments. The ends of the pipes that the program inherits are closed here once it
// has started, or failed to.
static bool spawn(Program *program, char *file, char **args, char **env, const char *cwd,
                  const int64_t handles[3]) {
  uv_file children[3] = {-1, -1, -1};
  bool made[3] = {false, false, false};
  bool opened = true;
  for (int i = 0; i < 3 && opened; i++) {
    opened = open_pipe(handles[i], i == 0, &children[i], &made[i]);
  }
  uv_stdio_container_t stdio[3];
  for (int i = 0; i < 3; i++) {
    int fd = children[i] >= 0 ? children[i] : i;
    stdio[i] = (uv_stdio_container_t){.flags = UV_INHERIT_FD, .data.fd = fd};
    // libuv opens the null device for an ignored stream.
    if (handles[i] == DISCARDED_STREAM) stdio[i] = (uv_stdio_container_t){.flags = UV_IGNORE};
  }
  // As `2>&1`: the errors go to what the output goes to, the same file, so in the order written.
  if (handles[2] == AS_STDOUT_STREAM) stdio[2] = stdio[1];
  uv_process_options_t options = {
    .exit_cb = exit_program,
    .file = file,
    .args = args,
    .env = env,
    .cwd = cwd,
    .flags = UV_PROCESS_WINDOWS_FILE_PATH_EXACT_NAME,
    .stdio_count = 3,
    .stdio = stdio,
  };
  program->process.data = program;
  bool spawned = opened && uv_spawn(uv_default_loop(), &program->process, &options) == 0;
  for (int i = 0; i < 3; i++) {
    if (made[i]) lerta_os_close(children[i]);
  }
  if (spawned) {
    program->open_handles++;
    return true;
  }
  // A failed spawn still has its handle closed, as libuv asks.
  if (opened) {
    program->open_handles++;
    close_handle(&program->process);
  }
  return false;
}

int64_t lerta_program_run(const LertaArray *args, const LertaString *cwd, const LertaArray *env,
                          const LertaArray *streams, int64_t kill_after) {
  char **c_args = c_strings_of(args);
  char *file = lerta_os_program_file(c_args[0]);
  char **c_env = env == NULL ? NULL : c_strings_of(env);
  char *c_cwd = cwd == NULL ? NULL : lerta_c_string(cwd);
  Program *program = lerta_checked_calloc(1, sizeof(Program));
  program->kill_after = (uint64_t)kill_after;
  // Without this, the child's output could come before what this program printed first. A failed
  // flush is remembered and reported by the exit code, as for any other write to stdout.
  lerta_output_flush();
  const int64_t handles[3] = {
    lerta_word_item(streams, 0), lerta_word_item(streams, 1), lerta_word_item(streams, 2)};
  bool spawned = file != NULL && spawn(program, file, c_args, c_env, c_cwd, handles);
  free_c_strings(c_args);
  free(file);
  if (c_env != NULL) free_c_strings(c_env);
  free(c_cwd);
  if (spawned) return (int64_t)(intptr_t)program;
  program->freed = true;
  free_program_if_done(program);
  return 0;
}

void lerta_system_pipe(LertaArray *files) {
  uv_file ends[2];
  if (uv_pipe(ends, 0, 0) != 0) {
    lerta_raise(LERTA_IO_ERROR, LERTA_STR(cannot_make_pipe));
    return;
  }
  for (int i = 0; i < 2; i++) {
    int64_t file = ends[i];
    lerta_array_append(files, &file);
  }
}

void lerta_file_close(int64_t file) { lerta_os_close(file); }

// Its cancel stops the program, and rejects the promise once it has ended.
static void cancel_wait(void *context) {
  Program *program = context;
  program->cancelled = true;
  lerta_program_stop((int64_t)(intptr_t)program);
}

LertaPromise *lerta_program_wait(int64_t pointer) {
  Program *program = program_of(pointer);
  LertaPromise *promise = lerta_promise_new(LERTA_PLAIN_ITEMS);
  lerta_retain(promise);
  program->waiting = promise;
  if (program->exited) {
    settle_wait(program);
    return promise;
  }
  lerta_promise_on_cancel(promise, cancel_wait, program);
  return promise;
}

void lerta_program_free(int64_t pointer) {
  Program *program = program_of(pointer);
  program->freed = true;
  free_program_if_done(program);
}

bool lerta_same_env_name(const LertaString *a, const LertaString *b) {
  return lerta_with_c_strings(a, b, lerta_os_same_env_name);
}

// std:process gives no name that holds `=`.
LertaString *lerta_env(const LertaString *name) {
  char *c_name = lerta_c_string(name);
  char *value = lerta_os_env(c_name);
  free(c_name);
  return lerta_string_from_os(value);
}

LertaString *lerta_executable(void) { return lerta_string_from_os(lerta_os_executable()); }

int64_t lerta_cpu_count(void) { return lerta_os_cpu_count(); }

void lerta_environ(LertaArray *entries) { lerta_os_environ(entries); }

int64_t lerta_process_id(void) { return lerta_os_process_id(); }

bool lerta_is_running(int64_t id) { return lerta_os_is_running((int)id); }

int64_t lerta_platform_member(const LertaString *const *texts, int64_t count) {
  const char *name = lerta_os_platform();
  int64_t length = (int64_t)strlen(name);
  for (int64_t i = 0; i < count; i++) {
    if (texts[i]->length == length && memcmp(texts[i]->bytes, name, (size_t)length) == 0) return i;
  }
  lerta_panic("no member of Platform names the system");
}
