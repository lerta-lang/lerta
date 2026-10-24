#include <math.h>
#include <signal.h>
#include <stdlib.h>
#include <string.h>

#include <uv.h>

#include "internal.h"

LERTA_STATIC_STRING(cannot_run, "cannot run: ");
LERTA_STATIC_STRING(cannot_read_output, "cannot read the output of: ");
LERTA_STATIC_STRING(output_too_long, "the output is too long: ");

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

// std:process checks that the code is from 0 to 255.
void lerta_exit(int64_t code) {
  bool flushed = lerta_output_flush_at_end(false);
  if (lerta_report_unreachable()) lerta_os_exit(LERTA_LEAK_EXIT_CODE);
  lerta_os_exit(flushed || code != 0 ? (int)code : 1);
}

// Appends the bytes of the string to the array of bytes, and releases the string.
static void append_bytes(LertaArray *array, LertaString *bytes) {
  for (int64_t i = 0; i < bytes->length; i++) lerta_array_append(array, &bytes->bytes[i]);
  lerta_release(bytes);
}

// The command and the arguments as C strings, ending with NULL, which free_c_args frees.
static char **c_args_of(const LertaString *command, const LertaArray *args) {
  int64_t count = args->length + 1;
  char **c_args = lerta_checked_calloc((size_t)count + 1, sizeof(char *));
  c_args[0] = lerta_c_string(command);
  for (int64_t i = 1; i < count; i++) {
    c_args[i] = lerta_c_string((const LertaString *)(intptr_t)lerta_word_item(args, i - 1));
  }
  return c_args;
}

static void free_c_args(char **c_args, int64_t count) {
  for (int64_t i = 0; i < count; i++) free(c_args[i]);
  free(c_args);
}

typedef struct RunningProgram RunningProgram;

typedef struct {
  LertaPromise *promise;
  LertaString *command;
  LertaArray *outputs[2];
  RunningProgram *program;
  bool cancelled;
} Run;

// The streams that the run reads, read or not, their bytes appended to the arrays where they are,
// if they are all read and kept.
static bool append_outputs(Run *run, LertaString *read[2], bool kept) {
  bool all_read = true;
  for (int i = 0; i < 2; i++) {
    if (run->outputs[i] != NULL && read[i] == NULL) all_read = false;
  }
  for (int i = 0; i < 2; i++) {
    if (read[i] == NULL) continue;
    if (all_read && kept) append_bytes(run->outputs[i], read[i]);
    else lerta_release(read[i]);
  }
  return all_read;
}

// Called once the program has exited and the streams that are read have ended, with its exit code,
// or minus the signal that ended it; its standard output and error, owned, or NULL for one that is
// not read or cannot be; and whether one of them went past the limit, which stopped it. The run
// holds the promise, the command and the arrays until then.
static void end_run(void *context, int64_t status, LertaString *output, LertaString *errors,
                    bool too_long) {
  Run *run = context;
  LertaString *read[2] = {output, errors};
  bool all_read = append_outputs(run, read, !run->cancelled && !too_long);
  if (run->cancelled) {
    lerta_promise_reject_cancelled(run->promise);
  } else if (too_long) {
    lerta_raise_with(LERTA_IO_ERROR, &output_too_long, run->command);
    lerta_promise_reject(run->promise);
  } else if (!all_read) {
    lerta_raise_with(LERTA_IO_ERROR, &cannot_read_output, run->command);
    lerta_promise_reject(run->promise);
  } else {
    *(int64_t *)lerta_promise_slot(run->promise) = status;
    lerta_promise_resolve(run->promise);
  }
  lerta_release(run->promise);
  lerta_release(run->command);
  for (int i = 0; i < 2; i++) {
    if (run->outputs[i] != NULL) lerta_release(run->outputs[i]);
  }
  free(run);
}

// How a program starts: the file `file`, as lerta_os_program_file gives it, with `args`, which
// start with the command and end with NULL; with the variables `env`, as NAME=VALUE ending with NULL,
// or else this program's; in the directory `cwd`, or else this program's; reading `stdin_fd`, or
// else this program's standard input; its standard output and error, `reads[0]` and `reads[1]`,
// read, or else shared with this program; the most bytes that each read stream may give, or -1 for
// no limit; and the milliseconds that a stop waits before it kills the program.
typedef struct {
  char *file;
  char **args;
  char **env;
  const char *cwd;
  int stdin_fd;
  bool reads[2];
  int64_t output_limit;
  uint64_t kill_after;
} ProgramSpec;

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
struct RunningProgram {
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
  Run *run;
};

static void stop_program(RunningProgram *program);

static void free_program(uv_handle_t *handle) {
  RunningProgram *program = handle->data;
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
static void end_program_if_done(RunningProgram *program) {
  if (!program->exited) return;
  for (int i = 0; i < 2; i++) {
    if (program->outputs[i].is_read && !program->outputs[i].ended) return;
  }
  LertaString *output = output_text(&program->outputs[0]);
  LertaString *errors = output_text(&program->outputs[1]);
  end_run(program->run, program->status, output, errors, program->too_long);
  if (program->stopping) close_handle(&program->kill_timer);
  close_handle(&program->process);
  for (int i = 0; i < 2; i++) {
    if (program->outputs[i].is_read) close_handle(&program->outputs[i].pipe);
  }
}

// A stopped program's output is not wanted, and a program that it started may hold its pipes
// open, so they are not waited for.
static void exit_program(uv_process_t *process, int64_t exit_status, int term_signal) {
  RunningProgram *program = process->data;
  program->exited = true;
  program->status = term_signal != 0 ? -term_signal : exit_status;
  if (program->stopping) {
    uv_timer_stop(&program->kill_timer);
    for (int i = 0; i < 2; i++) stop_reading(&program->outputs[i]);
  }
  end_program_if_done(program);
}

static ProgramOutput *output_of(uv_handle_t *handle) {
  RunningProgram *program = handle->data;
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
  RunningProgram *program = stream->data;
  ProgramOutput *output = output_of((uv_handle_t *)stream);
  if (count > 0) output->length += (size_t)count;
  bool is_too_long = program->output_limit >= 0 && output->length > (size_t)program->output_limit;
  if (is_too_long && !program->too_long) {
    program->too_long = true;
    for (int i = 0; i < 2; i++) stop_reading(&program->outputs[i]);
    stop_program(program);
  }
  if (count >= 0) return;
  output->failed = count != UV_EOF;
  stop_reading(output);
  end_program_if_done(stream->data);
}

// Starts the program, which calls end_run once; NULL if it cannot start, and end_run is not called.
static RunningProgram *start_program(const ProgramSpec *spec, Run *run) {
  uv_loop_t *loop = uv_default_loop();
  RunningProgram *program = lerta_checked_calloc(1, sizeof(RunningProgram));
  program->run = run;
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
  RunningProgram *program = timer->data;
  uv_process_kill(&program->process, SIGKILL);
}

// SIGTERM lets the program end as it chooses, and SIGKILL ends it if it does not in time. On
// Windows, either one terminates it at once. A program that has exited already has only its
// output left, which is not waited for, as at its exit after a stop.
static void stop_program(RunningProgram *program) {
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

// Cancelling a run stops the program, and the run ends once it has (see end_run).
static void cancel_run(void *context) {
  Run *run = context;
  run->cancelled = true;
  stop_program(run->program);
}

// The strings as C strings, ending with NULL, which free_c_args frees.
static char **c_strings_of(const LertaArray *strings) {
  char **c_strings = lerta_checked_calloc((size_t)strings->length + 1, sizeof(char *));
  for (int64_t i = 0; i < strings->length; i++) {
    c_strings[i] = lerta_c_string((const LertaString *)(intptr_t)lerta_word_item(strings, i));
  }
  return c_strings;
}

// What the run gives the program, which free_spec frees; whether all can be given is written to
// `valid`.
static ProgramSpec program_spec(const LertaString *command, const LertaArray *args,
                                     const LertaString *input, const LertaString *cwd,
                                     const LertaArray *env, bool *valid) {
  int64_t count = args->length + 1;
  ProgramSpec spec = {.stdin_fd = -1};
  char **c_args = c_args_of(command, args);
  spec.file = lerta_os_program_file(c_args[0]);
  if (spec.file != NULL) spec.args = c_args;
  else free_c_args(c_args, count);
  *valid = spec.file != NULL;
  if (env != NULL) spec.env = c_strings_of(env);
  if (cwd != NULL) spec.cwd = lerta_c_string(cwd);
  if (input != NULL) {
    spec.stdin_fd = lerta_os_input_file(input->bytes, input->length);
    *valid = *valid && spec.stdin_fd >= 0;
  }
  return spec;
}

static void free_spec(ProgramSpec *spec, int64_t count) {
  if (spec->args != NULL) free_c_args(spec->args, count);
  free(spec->file);
  if (spec->env != NULL) {
    int64_t length = 0;
    while (spec->env[length] != NULL) length++;
    free_c_args(spec->env, length);
  }
  free((char *)spec->cwd);
  if (spec->stdin_fd >= 0) lerta_os_close_input_file(spec->stdin_fd);
}

// The promise is resolved with the exit code, or minus the signal that ended the program.
LertaPromise *lerta_run(const LertaString *command, const LertaArray *args,
                        const LertaString *input, LertaArray *output, LertaArray *errors,
                        const LertaString *cwd, const LertaArray *env, int64_t output_limit,
                        double kill_after) {
  bool valid;
  ProgramSpec spec = program_spec(command, args, input, cwd, env, &valid);
  spec.reads[0] = output != NULL;
  spec.reads[1] = errors != NULL;
  spec.output_limit = output_limit;
  // Rounded up, so as not to kill early; std:process checks that the time is not negative.
  double milliseconds = ceil(kill_after * 1000);
  spec.kill_after = milliseconds < 0x1p63 ? (uint64_t)milliseconds : UINT64_MAX;
  // Without this, the child's output could come before what this program printed first. A failed
  // flush is remembered and reported by the exit code, as for any other write to stdout.
  lerta_output_flush();
  Run *run = lerta_checked_calloc(1, sizeof(Run));
  RunningProgram *program = valid ? start_program(&spec, run) : NULL;
  free_spec(&spec, args->length + 1);
  if (program == NULL) {
    free(run);
    lerta_raise_with(LERTA_IO_ERROR, &cannot_run, command);
    return NULL;
  }
  LertaPromise *promise = lerta_promise_new(LERTA_PLAIN_ITEMS);
  lerta_retain(promise);
  lerta_retain((void *)command);
  if (output != NULL) lerta_retain(output);
  if (errors != NULL) lerta_retain(errors);
  *run = (Run){promise, (LertaString *)command, {output, errors}, program, false};
  lerta_promise_on_cancel(promise, cancel_run, run);
  return promise;
}

bool lerta_same_env_name(const LertaString *a, const LertaString *b) {
  char *c_a = lerta_c_string(a);
  char *c_b = lerta_c_string(b);
  bool same = lerta_os_same_env_name(c_a, c_b);
  free(c_a);
  free(c_b);
  return same;
}

// std:process gives no name that holds `=`.
LertaString *lerta_env(const LertaString *name) {
  char *c_name = lerta_c_string(name);
  char *value = lerta_os_env(c_name);
  free(c_name);
  if (value == NULL) return NULL;
  LertaString *result = lerta_string_from_c(value);
  free(value);
  return result;
}

int64_t lerta_cpu_count(void) { return lerta_os_cpu_count(); }

void lerta_environ(LertaArray *entries) { lerta_os_environ(entries); }

int64_t lerta_process_id(void) { return lerta_os_process_id(); }

bool lerta_is_running(int64_t id) { return lerta_os_is_running((int)id); }

LertaString *lerta_platform(void) {
  const char *name = lerta_os_platform();
  return lerta_string_from_c(name);
}
