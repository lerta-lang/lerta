#include "internal.h"

// What the seed's IR calls, which the compiler now reads in place (see emit_binary_length).
int64_t lerta_binary_length(const LertaString *binary) { return binary->length; }

// As unsigned, a negative index is out of range too. For the seed's IR alone, as lerta_binary_length.
uint8_t lerta_binary_get(const LertaString *binary, int64_t index) {
  if ((uint64_t)index < (uint64_t)binary->length) return binary->bytes[index];
  lerta_raise_index_out_of_range();
  return 0;
}

LERTA_STATIC_STRING(slice_out_of_range, "slice out of range");

LertaString *lerta_binary_slice(const LertaString *binary, int64_t start, int64_t end) {
  if (start < 0 || start > end || end > binary->length) {
    lerta_raise(LERTA_INDEX_ERROR, (const LertaString *)&slice_out_of_range);
    return NULL;
  }
  return lerta_string_from_bytes(binary->bytes + start, end - start);
}

LertaString *lerta_binary_as_string(LertaString *binary) {
  lerta_retain(binary);
  return binary;
}
