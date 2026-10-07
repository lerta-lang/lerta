#include <string.h>

#include "lerta.h"

LERTA_STATIC_STRING(slice_out_of_range, "slice out of range");

int64_t lerta_binary_length(const LertaString *binary) { return binary->length; }

uint8_t lerta_binary_get(const LertaString *binary, int64_t index) {
  if (index < 0 || index >= binary->length) lerta_throw_index_out_of_range();
  return binary->bytes[index];
}

// `end` is exclusive.
LertaString *lerta_binary_slice(const LertaString *binary, int64_t start, int64_t end) {
  if (start < 0 || start > end || end > binary->length) {
    lerta_throw((const LertaString *)&slice_out_of_range);
  }
  int64_t length = end - start;
  LertaString *slice = lerta_alloc((int64_t)sizeof(LertaString) + length, NULL);
  slice->length = length;
  memcpy(slice->bytes, binary->bytes + start, (size_t)length);
  return slice;
}

// The number of bytes of the UTF-8 sequence starting with `lead`, or 0 if it cannot start one.
static int64_t sequence_length(uint8_t lead) {
  if (lead < 0x80) return 1;
  if (lead >= 0xC2 && lead <= 0xDF) return 2;
  if (lead >= 0xE0 && lead <= 0xEF) return 3;
  if (lead >= 0xF0 && lead <= 0xF4) return 4;
  return 0;
}

// Rejects overlong forms, surrogates and code points above U+10FFFF, as the standard requires.
bool lerta_is_valid_utf8(const uint8_t *bytes, int64_t length) {
  for (int64_t i = 0; i < length;) {
    int64_t n = sequence_length(bytes[i]);
    if (n == 0 || i + n > length) return false;
    for (int64_t k = 1; k < n; k++) {
      if ((bytes[i + k] & 0xC0) != 0x80) return false;
    }
    uint8_t second = n > 1 ? bytes[i + 1] : 0;
    if (bytes[i] == 0xE0 && second < 0xA0) return false;
    if (bytes[i] == 0xED && second > 0x9F) return false;
    if (bytes[i] == 0xF0 && second < 0x90) return false;
    if (bytes[i] == 0xF4 && second > 0x8F) return false;
    i += n;
  }
  return true;
}

LertaString *lerta_binary_decode_utf8(LertaString *binary) {
  if (!lerta_is_valid_utf8(binary->bytes, binary->length)) return NULL;
  lerta_retain(binary);
  return binary;
}
