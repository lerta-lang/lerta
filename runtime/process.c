#include <math.h>
#include <stdlib.h>
#include <string.h>

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

typedef struct {
  LertaPromise *promise;
  LertaString *command;
  LertaArray *outputs[2];
  LertaRunningProgram *program;
  bool cancelled;
} Run;

// Cancelling a run stops the program, and the run ends once it has (see end_run).
static void cancel_run(void *context) {
  Run *run = context;
  run->cancelled = true;
  lerta_loop_stop_program(run->program);
}

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

// The run holds the promise, the command and the arrays until the program ends.
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
static LertaProgramSpec program_spec(const LertaString *command, const LertaArray *args,
                                     const LertaString *input, const LertaString *cwd,
                                     const LertaArray *env, bool *valid) {
  int64_t count = args->length + 1;
  LertaProgramSpec spec = {.stdin_fd = -1};
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

static void free_spec(LertaProgramSpec *spec, int64_t count) {
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
  LertaProgramSpec spec = program_spec(command, args, input, cwd, env, &valid);
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
  LertaRunningProgram *program = valid ? lerta_loop_run_program(&spec, end_run, run) : NULL;
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
