#include <stdlib.h>
#include <string.h>

#include <uv.h>

#include "internal.h"

LERTA_STATIC_STRING(exit_code_out_of_range, "exit code out of range (0 to 255)");
LERTA_STATIC_STRING(cannot_run, "cannot run: ");
LERTA_STATIC_STRING(cannot_read_output, "cannot read the output of: ");

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
    LertaString *argument = lerta_string_from_bytes(arguments[i], (int64_t)strlen(arguments[i]));
    lerta_array_append(result, &argument);
    lerta_release(argument);
  }
  return result;
}

// POSIX systems keep only 8 bits of an exit code, so a code outside 0 to 255 would be misread.
void lerta_exit(int64_t code) {
  if (code < 0 || code > 255) {
    lerta_raise(LERTA_VALUE_ERROR, (const LertaString *)&exit_code_out_of_range);
    return;
  }
  bool flushed = lerta_output_flush_at_end(false);
  lerta_os_exit(flushed || code != 0 ? (int)code : 1);
}

// Appends the bytes of the string to the array of bytes, and releases the string.
static void append_bytes(LertaArray *array, LertaString *bytes) {
  for (int64_t i = 0; i < bytes->length; i++) lerta_array_append(array, &bytes->bytes[i]);
  lerta_release(bytes);
}

// The command and the arguments as C strings, ending with NULL, which free_c_args frees; whether
// none holds a NUL byte is written to `valid`.
static char **c_args_of(const LertaString *command, const LertaArray *args, bool *valid) {
  int64_t count = args->length + 1;
  char **c_args = lerta_checked_calloc((size_t)count + 1, sizeof(char *));
  c_args[0] = lerta_c_string(command);
  *valid = c_args[0] != NULL;
  for (int64_t i = 1; i < count; i++) {
    c_args[i] = lerta_c_string((const LertaString *)(intptr_t)lerta_word_item(args, i - 1));
    *valid = *valid && c_args[i] != NULL;
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
  LertaArray *output;
} Run;

// The run holds the promise, the command and the array until the program ends.
static void end_run(void *context, int64_t exit_code, LertaString *read_output) {
  Run *run = context;
  if (run->output != NULL && read_output == NULL) {
    lerta_raise_with(LERTA_IO_ERROR, &cannot_read_output, run->command);
    lerta_promise_reject(run->promise);
  } else {
    if (run->output != NULL) append_bytes(run->output, read_output);
    *(int64_t *)lerta_promise_slot(run->promise) = exit_code;
    lerta_promise_resolve(run->promise);
  }
  lerta_release(run->promise);
  lerta_release(run->command);
  if (run->output != NULL) lerta_release(run->output);
  free(run);
}

// The program's arguments as lerta_loop_run_program takes them: the file of the command first,
// then the arguments as the system takes them; NULL if the command is not found.
static char **program_args(char **c_args, int64_t count, char **file) {
  *file = lerta_os_program_file(c_args[0]);
  if (*file == NULL) return NULL;
  char **args = lerta_checked_calloc((size_t)count + 1, sizeof(char *));
  for (int64_t i = 0; i < count; i++) args[i] = lerta_os_program_argument(c_args[i]);
  return args;
}

LertaPromise *lerta_run(const LertaString *command, const LertaArray *args, LertaArray *output) {
  int64_t count = args->length + 1;
  bool valid;
  char **c_args = c_args_of(command, args, &valid);
  // Without this, the child's output could come before what this program printed first. A failed
  // flush is remembered and reported by the exit code, as for any other write to stdout.
  lerta_output_flush();
  char *file = NULL;
  char **spawned_args = valid ? program_args(c_args, count, &file) : NULL;
  Run *run = lerta_checked_malloc(sizeof(Run));
  bool reads_output = output != NULL;
  bool started = spawned_args != NULL &&
                 lerta_loop_run_program(file, spawned_args, reads_output, end_run, run);
  free_c_args(c_args, count);
  if (spawned_args != NULL) free_c_args(spawned_args, count);
  free(file);
  if (!started) {
    free(run);
    lerta_raise_with(LERTA_IO_ERROR, &cannot_run, command);
    return NULL;
  }
  LertaPromise *promise = lerta_promise_new(LERTA_PLAIN_ITEMS);
  lerta_retain(promise);
  lerta_retain((void *)command);
  if (output != NULL) lerta_retain(output);
  *run = (Run){promise, (LertaString *)command, output};
  return promise;
}

// No variable's name holds `=`, which the system would take as the end of the name.
LertaString *lerta_env(const LertaString *name) {
  char *c_name = lerta_c_string(name);
  bool can_be_set = c_name != NULL && strchr(c_name, '=') == NULL;
  char *value = can_be_set ? lerta_os_env(c_name) : NULL;
  free(c_name);
  if (value == NULL) return NULL;
  LertaString *result = lerta_string_from_bytes(value, (int64_t)strlen(value));
  free(value);
  return result;
}

int64_t lerta_cpu_count(void) { return lerta_os_cpu_count(); }

int64_t lerta_process_id(void) { return uv_os_getpid(); }

// Signal 0 only checks the process. The ID is checked first, since kill takes 0 and the negative
// IDs for groups of processes. A process that the program may not signal is still running.
bool lerta_is_running(int64_t id) {
  if (id <= 0 || id > INT32_MAX) return false;
  return uv_kill((int)id, 0) != UV_ESRCH;
}

LertaString *lerta_platform(void) {
  const char *name = lerta_os_platform();
  return lerta_string_from_bytes(name, (int64_t)strlen(name));
}
