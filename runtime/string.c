#include <stdarg.h>
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

LertaString *lerta_string_concat(int64_t count, ...) {
  va_list args;
  va_start(args, count);
  int64_t length = 0;
  for (int64_t i = 0; i < count; i++) length += va_arg(args, const LertaString *)->length;
  va_end(args);

  LertaString *result = lerta_alloc((int64_t)sizeof(LertaString) + length);
  result->length = length;
  int64_t offset = 0;
  va_start(args, count);
  for (int64_t i = 0; i < count; i++) {
    const LertaString *part = va_arg(args, const LertaString *);
    memcpy(result->bytes + offset, part->bytes, (size_t)part->length);
    offset += part->length;
  }
  va_end(args);
  return result;
}

bool lerta_string_equals(const LertaString *a, const LertaString *b) {
  return a->length == b->length && memcmp(a->bytes, b->bytes, (size_t)a->length) == 0;
}
