#include "internal.h"

int64_t lerta_binary_length(const LertaString *binary) { return binary->length; }

// As unsigned, a negative index is out of range too, and the test is the one that the generated code
// makes to tell the throw (see emit_binary_out_of_range), which LLVM then makes once.
uint8_t lerta_binary_get(const LertaString *binary, int64_t index) {
  if ((uint64_t)index < (uint64_t)binary->length) return binary->bytes[index];
  lerta_raise_index_out_of_range();
  return 0;
}

LertaString *lerta_binary_as_string(LertaString *binary) {
  lerta_retain(binary);
  return binary;
}
