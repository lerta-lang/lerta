#include <string.h>
#include <unistd.h>

#include "lerta.h"

LERTA_STATIC_STRING(invalid_argument, "a command-line argument is not valid UTF-8");
LERTA_STATIC_STRING(exit_code_out_of_range, "exit code out of range (0 to 255)");

static int argument_count = 0;
static char **arguments = NULL;

void lerta_set_arguments(int argc, char **argv) {
  argument_count = argc;
  arguments = argv;
}

LertaArray *lerta_argv(void) {
  LertaArray *result = lerta_array_new(true);
  for (int i = 1; i < argument_count; i++) {
    int64_t length = (int64_t)strlen(arguments[i]);
    // A String must be valid UTF-8.
    if (!lerta_is_valid_utf8((const uint8_t *)arguments[i], length)) {
      lerta_throw((const LertaString *)&invalid_argument);
    }
    LertaString *argument = lerta_alloc((int64_t)sizeof(LertaString) + length, NULL);
    argument->length = length;
    memcpy(argument->bytes, arguments[i], (size_t)length);
    lerta_array_push(result, (int64_t)(intptr_t)argument);
    lerta_release(argument);
  }
  return result;
}

// The system keeps only 8 bits of an exit code, so a code outside 0 to 255 would be misread.
void lerta_exit(int64_t code) {
  if (code < 0 || code > 255) lerta_throw((const LertaString *)&exit_code_out_of_range);
  bool flushed = lerta_stdout_flush();
  _exit(flushed || code != 0 ? (int)code : 1);
}
