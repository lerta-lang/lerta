#include "internal.h"

int64_t lerta_binary_length(const LertaString *binary) { return binary->length; }

uint8_t lerta_binary_get(const LertaString *binary, int64_t index) {
  if (index >= 0 && index < binary->length) return binary->bytes[index];
  lerta_raise_index_out_of_range();
  return 0;
}

LertaString *lerta_binary_as_string(LertaString *binary) {
  lerta_retain(binary);
  return binary;
}
