#include <stdlib.h>
#include <string.h>

#include "internal.h"

LERTA_STATIC_STRING(pop_from_empty, "pop from an empty array");

int64_t lerta_item_size(LertaItemKind kind) {
  switch (kind) {
    case LERTA_INTERFACE_ITEMS: return 2 * (int64_t)sizeof(void *);
    case LERTA_BYTE_ITEMS: return 1;
    default: return 8;
  }
}

// The reference an item holds is its first 8 bytes: a reference, or an interface value's data.
static void *reference_of(LertaItemKind kind, const void *item) {
  if (kind == LERTA_PLAIN_ITEMS || kind == LERTA_BYTE_ITEMS) return NULL;
  void *reference;
  memcpy(&reference, item, sizeof reference);
  return reference;
}

void lerta_retain_item(LertaItemKind kind, const void *item) {
  lerta_retain(reference_of(kind, item));
}

void lerta_release_item(LertaItemKind kind, const void *item) {
  lerta_release(reference_of(kind, item));
}

static uint8_t *item_at(const LertaArray *array, int64_t index) {
  return array->items + index * lerta_item_size(array->item_kind);
}

int64_t lerta_word_item(const LertaArray *array, int64_t index) {
  if (array->item_kind == LERTA_BYTE_ITEMS) return array->items[index];
  int64_t item;
  memcpy(&item, item_at(array, index), sizeof item);
  return item;
}

static void drop_array(void *object) {
  LertaArray *array = object;
  for (int64_t i = 0; i < array->length; i++) {
    lerta_release_item(array->item_kind, item_at(array, i));
  }
  free(array->items);
}

LertaArray *lerta_array_create(LertaItemKind item_kind) {
  LertaArray *array = lerta_alloc((int64_t)sizeof(LertaArray), drop_array);
  array->length = 0;
  array->capacity = 0;
  array->items = NULL;
  array->item_kind = item_kind;
  return array;
}

int64_t lerta_array_length(const LertaArray *array) { return array->length; }

LERTA_STATIC_STRING(index_out_of_range, "index out of range");

void lerta_raise_index_out_of_range(void) {
  lerta_raise(LERTA_INDEX_ERROR, (const LertaString *)&index_out_of_range);
}

uint8_t *lerta_array_checked_items(const LertaArray *array, int64_t index) {
  if (index >= 0 && index < array->length) return array->items;
  lerta_raise_index_out_of_range();
  return NULL;
}

void lerta_array_read(const LertaArray *array, int64_t index, void *item) {
  if (lerta_array_checked_items(array, index) == NULL) return;
  memcpy(item, item_at(array, index), (size_t)lerta_item_size(array->item_kind));
  lerta_retain_item(array->item_kind, item);
}

// The new item is retained before the old one is released, in case they are the same object.
void lerta_array_write(LertaArray *array, int64_t index, const void *item) {
  if (lerta_array_checked_items(array, index) == NULL) return;
  lerta_retain_item(array->item_kind, item);
  LertaItem old;
  size_t size = (size_t)lerta_item_size(array->item_kind);
  memcpy(&old, item_at(array, index), size);
  memcpy(item_at(array, index), item, size);
  lerta_release_item(array->item_kind, &old);
}

// Kept out of lerta_array_pushed_items, so that the rest, which most pushes end in, is small
// enough for LLVM to inline into the generated code.
__attribute__((noinline)) static void grow(LertaArray *array) {
  int64_t capacity = array->capacity == 0 ? 4 : array->capacity * 2;
  size_t size = (size_t)lerta_item_size(array->item_kind);
  array->items = lerta_checked_realloc(array->items, (size_t)capacity * size);
  array->capacity = capacity;
}

uint8_t *lerta_array_pushed_items(LertaArray *array) {
  if (array->length == array->capacity) grow(array);
  array->length++;
  return array->items;
}

void lerta_array_append(LertaArray *array, const void *item) {
  lerta_array_pushed_items(array);
  lerta_retain_item(array->item_kind, item);
  memcpy(item_at(array, array->length - 1), item, (size_t)lerta_item_size(array->item_kind));
}

void lerta_array_append_word(LertaArray *array, int64_t word) {
  uint8_t byte = (uint8_t)word;
  lerta_array_append(array, array->item_kind == LERTA_BYTE_ITEMS ? (void *)&byte : &word);
}

// The array's reference to the item passes to the caller.
void lerta_array_take_last(LertaArray *array, void *item) {
  if (array->length == 0) {
    lerta_raise(LERTA_INDEX_ERROR, (const LertaString *)&pop_from_empty);
    return;
  }
  array->length--;
  memcpy(item, item_at(array, array->length), (size_t)lerta_item_size(array->item_kind));
}

LertaString *lerta_string_join(const LertaArray *strings, const LertaString *separator) {
  int64_t length = 0;
  for (int64_t i = 0; i < strings->length; i++) {
    length += ((const LertaString *)(intptr_t)lerta_word_item(strings, i))->length;
  }
  if (strings->length > 0) length += separator->length * (strings->length - 1);
  LertaString *result = lerta_string_new(length);
  int64_t offset = 0;
  for (int64_t i = 0; i < strings->length; i++) {
    if (i > 0) {
      memcpy(result->bytes + offset, separator->bytes, (size_t)separator->length);
      offset += separator->length;
    }
    const LertaString *part = (const LertaString *)(intptr_t)lerta_word_item(strings, i);
    memcpy(result->bytes + offset, part->bytes, (size_t)part->length);
    offset += part->length;
  }
  return result;
}

bool lerta_array_equals(const LertaArray *a, const LertaArray *b, LertaEquals equals) {
  if (a->length != b->length) return false;
  for (int64_t i = 0; i < a->length; i++) {
    if (!equals(lerta_word_item(a, i), lerta_word_item(b, i))) return false;
  }
  return true;
}

uint64_t lerta_array_hash(const LertaArray *array, LertaHash hash) {
  uint64_t result = (uint64_t)array->length;
  for (int64_t i = 0; i < array->length; i++) {
    result = result * 31 + hash(lerta_word_item(array, i));
  }
  return result;
}
