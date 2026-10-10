#include "lerta.h"

LERTA_STATIC_STRING(slice_out_of_range, "slice out of range");

int64_t lerta_binary_length(const LertaString *binary) { return binary->length; }

uint8_t lerta_binary_get(const LertaString *binary, int64_t index) {
  if (index < 0 || index >= binary->length) lerta_throw_index_out_of_range();
  return binary->bytes[index];
}

int64_t lerta_byte_to_int(uint8_t byte) { return byte; }

// The caller has checked that `n` fits in a byte.
uint8_t lerta_int_to_byte(int64_t n) { return (uint8_t)n; }

// `end` is exclusive.
LertaString *lerta_binary_slice(const LertaString *binary, int64_t start, int64_t end) {
  if (start < 0 || start > end || end > binary->length) {
    lerta_throw((const LertaString *)&slice_out_of_range);
  }
  return lerta_string_from_bytes(binary->bytes + start, end - start);
}

// The items of an Array<Byte>, each held in the low 8 bits of its slot.
LertaString *lerta_binary_from_bytes(const LertaArray *bytes) {
  LertaString *binary = lerta_string_new(bytes->length);
  for (int64_t i = 0; i < bytes->length; i++) binary->bytes[i] = (uint8_t)LERTA_WORD_ITEM(bytes, i);
  return binary;
}

LertaString *lerta_binary_as_string(LertaString *binary) {
  lerta_retain(binary);
  return binary;
}
