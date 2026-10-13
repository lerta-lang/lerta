#include <stdlib.h>
#include <string.h>

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
  bool flushed = lerta_stdout_flush();
  lerta_os_exit(flushed || code != 0 ? (int)code : 1);
}

// Appends the bytes of the string to the array of bytes, and releases the string.
static void append_bytes(LertaArray *array, LertaString *bytes) {
  for (int64_t i = 0; i < bytes->length; i++) lerta_array_append(array, &bytes->bytes[i]);
  lerta_release(bytes);
}

int64_t lerta_run(const LertaString *command, const LertaArray *args, LertaArray *output) {
  int64_t count = args->length + 1;
  char **c_args = lerta_checked_calloc((size_t)count + 1, sizeof(char *));
  c_args[0] = lerta_c_string(command);
  bool valid = c_args[0] != NULL;
  for (int64_t i = 1; i < count; i++) {
    c_args[i] = lerta_c_string((const LertaString *)(intptr_t)lerta_word_item(args, i - 1));
    valid = valid && c_args[i] != NULL;
  }
  // Without this, the child's output could come before what this program printed first. A failed
  // flush is remembered and reported by the exit code, as for any other write to stdout.
  lerta_stdout_flush();
  int64_t exit_code;
  LertaString *read_output = NULL;
  bool ran = valid && lerta_os_run(c_args, output == NULL ? NULL : &read_output, &exit_code);
  for (int64_t i = 0; i < count; i++) free(c_args[i]);
  free(c_args);
  if (!ran) {
    lerta_raise_with(LERTA_IO_ERROR, &cannot_run, command);
    return 0;
  }
  if (output != NULL && read_output == NULL) {
    lerta_raise_with(LERTA_IO_ERROR, &cannot_read_output, command);
    return 0;
  }
  if (output != NULL) append_bytes(output, read_output);
  return exit_code;
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
