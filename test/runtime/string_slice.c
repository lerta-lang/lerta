// lerta_string_slice of "aé😀" (61 C3 A9 F0 9F 98 80) at each place, printing the slice or the
// error it throws.
#include <stdio.h>

#include "lerta.h"

static void print_error(int32_t kind, const LertaString *message) {
  printf("error %d: %.*s\n", kind, (int)message->length, (const char *)message->bytes);
}

static void slice(const LertaString *s, int64_t start, int64_t end) {
  LertaString *result = lerta_string_slice(s, start, end);
  if (result == NULL) return;
  printf("'%.*s'\n", (int)result->length, (const char *)result->bytes);
  lerta_release(result);
}

void lerta_main(void) {
  lerta_register_raise(print_error);
  LertaString *s = lerta_string_from_bytes("a\xC3\xA9\xF0\x9F\x98\x80", 7);
  int64_t places[][2] = {
      {0, 1}, {1, 3}, {3, 7}, {7, 7}, {0, 2}, {2, 3}, {3, 6}, {6, 7}, {-1, 1}, {2, 1}, {1, 8}};
  for (size_t i = 0; i < sizeof places / sizeof places[0]; i++) slice(s, places[i][0], places[i][1]);
  lerta_release(s);
  fflush(stdout);
}
