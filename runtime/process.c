#include <stdlib.h>
#include <string.h>

#include "lerta.h"

LERTA_STATIC_STRING(exit_code_out_of_range, "exit code out of range (0 to 255)");
LERTA_STATIC_STRING(cannot_run, "cannot run: ");

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

int64_t lerta_run(const LertaString *command, const LertaArray *args) {
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
  bool ran = valid && lerta_os_run(c_args, &exit_code);
  for (int64_t i = 0; i < count; i++) free(c_args[i]);
  free(c_args);
  if (!ran) {
    LertaString *message = lerta_string_concat(2, &cannot_run, command);
    lerta_raise(LERTA_IO_ERROR, message);
    lerta_release(message);
    return 0;
  }
  return exit_code;
}
