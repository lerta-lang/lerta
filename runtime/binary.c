#include <string.h>

#include "internal.h"

LERTA_STATIC_STRING(slice_out_of_range, "slice out of range");

int64_t lerta_binary_length(const LertaString *binary) { return binary->length; }

uint8_t lerta_binary_get(const LertaString *binary, int64_t index) {
  if (index >= 0 && index < binary->length) return binary->bytes[index];
  lerta_raise_index_out_of_range();
  return 0;
}

// `end` is exclusive.
LertaString *lerta_binary_slice(const LertaString *binary, int64_t start, int64_t end) {
  if (start < 0 || start > end || end > binary->length) {
    lerta_raise(LERTA_INDEX_ERROR, (const LertaString *)&slice_out_of_range);
    return NULL;
  }
  return lerta_string_from_bytes(binary->bytes + start, end - start);
}

int64_t lerta_binary_find(const LertaString *binary, const LertaString *part, int64_t from) {
  int64_t last_start = binary->length - part->length;
  for (int64_t i = from; i <= last_start; i++) {
    const uint8_t *candidate = memchr(binary->bytes + i, part->bytes[0], (size_t)(last_start - i + 1));
    if (candidate == NULL) return -1;
    i = candidate - binary->bytes;
    if (memcmp(candidate, part->bytes, (size_t)part->length) == 0) return i;
  }
  return -1;
}

int64_t lerta_utf8_sequence_length(uint8_t lead) {
  if (lead < 0x80) return 1;
  if (lead >= 0xC2 && lead <= 0xDF) return 2;
  if (lead >= 0xE0 && lead <= 0xEF) return 3;
  if (lead >= 0xF0 && lead <= 0xF4) return 4;
  return 0;
}

bool lerta_is_utf8_continuation(uint8_t byte) {
  return byte >= 0x80 && byte <= 0xBF;
}

// Overlong forms, surrogates and code points above U+10FFFF are not UTF-8, as the standard
// requires: the leads 0xE0, 0xED, 0xF0 and 0xF4 limit the byte after them.
bool lerta_is_utf8(const LertaString *binary) {
  const uint8_t *bytes = binary->bytes;
  int64_t i = 0;
  while (i < binary->length) {
    uint8_t lead = bytes[i];
    int64_t length = lerta_utf8_sequence_length(lead);
    if (length == 0 || i + length > binary->length) return false;
    for (int64_t k = 1; k < length; k++) {
      if (!lerta_is_utf8_continuation(bytes[i + k])) return false;
    }
    uint8_t second = length > 1 ? bytes[i + 1] : 0;
    if (lead == 0xE0 && second < 0xA0) return false;
    if (lead == 0xED && second > 0x9F) return false;
    if (lead == 0xF0 && second < 0x90) return false;
    if (lead == 0xF4 && second > 0x8F) return false;
    i += length;
  }
  return true;
}

LertaString *lerta_binary_as_string(LertaString *binary) {
  lerta_retain(binary);
  return binary;
}
