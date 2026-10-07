#include <string.h>

#include "lerta.h"

int64_t lerta_format_int(int64_t n, uint8_t buffer[LERTA_INT_TEXT_MAX]) {
  int64_t start = LERTA_INT_TEXT_MAX;
  // Working with the negative value avoids overflow on INT64_MIN.
  int64_t negative = n < 0 ? n : -n;
  do {
    buffer[--start] = (uint8_t)('0' - negative % 10);
    negative /= 10;
  } while (negative != 0);
  if (n < 0) buffer[--start] = '-';
  return start;
}

static LertaString *string_from_bytes(const uint8_t *bytes, int64_t length) {
  LertaString *s = lerta_alloc((int64_t)sizeof(LertaString) + length);
  s->length = length;
  memcpy(s->bytes, bytes, (size_t)length);
  return s;
}

LertaString *lerta_int_to_string(int64_t n) {
  uint8_t text[LERTA_INT_TEXT_MAX];
  int64_t start = lerta_format_int(n, text);
  return string_from_bytes(text + start, LERTA_INT_TEXT_MAX - start);
}
