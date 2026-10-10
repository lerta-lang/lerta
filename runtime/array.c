#include <stdlib.h>
#include <string.h>

#include "lerta.h"

LERTA_STATIC_STRING(pop_from_empty, "pop from an empty array");

int64_t lerta_item_size(LertaItemKind kind) { return kind == LERTA_INTERFACE_ITEMS ? 16 : 8; }

// The reference an item holds is its first 8 bytes: a reference, or an interface value's data.
static void *reference_of(LertaItemKind kind, const void *item) {
  if (kind == LERTA_PLAIN_ITEMS) return NULL;
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

static void check_index(const LertaArray *array, int64_t index) {
  if (index < 0 || index >= array->length) lerta_throw_index_out_of_range();
}

void lerta_array_read(const LertaArray *array, int64_t index, void *item) {
  check_index(array, index);
  memcpy(item, item_at(array, index), (size_t)lerta_item_size(array->item_kind));
  lerta_retain_item(array->item_kind, item);
}

// The new item is retained before the old one is released, in case they are the same object.
void lerta_array_write(LertaArray *array, int64_t index, const void *item) {
  check_index(array, index);
  lerta_retain_item(array->item_kind, item);
  LertaItem old;
  size_t size = (size_t)lerta_item_size(array->item_kind);
  memcpy(&old, item_at(array, index), size);
  memcpy(item_at(array, index), item, size);
  lerta_release_item(array->item_kind, &old);
}

void lerta_array_append(LertaArray *array, const void *item) {
  size_t size = (size_t)lerta_item_size(array->item_kind);
  if (array->length == array->capacity) {
    int64_t capacity = array->capacity == 0 ? 4 : array->capacity * 2;
    uint8_t *items = realloc(array->items, (size_t)capacity * size);
    if (items == NULL) lerta_panic("out of memory");
    array->items = items;
    array->capacity = capacity;
  }
  lerta_retain_item(array->item_kind, item);
  memcpy(item_at(array, array->length++), item, size);
}

// The array's reference to the item passes to the caller.
void lerta_array_take_last(LertaArray *array, void *item) {
  if (array->length == 0) lerta_throw((const LertaString *)&pop_from_empty);
  array->length--;
  memcpy(item, item_at(array, array->length), (size_t)lerta_item_size(array->item_kind));
}

// The 8-byte item API that the seed's generated code calls, over the one above, until the seed is
// refreshed (see docs/internals.md#bootstrap).
LertaArray *lerta_array_new(bool owns_references) {
  return lerta_array_create(owns_references ? LERTA_REFERENCE_ITEMS : LERTA_PLAIN_ITEMS);
}

int64_t lerta_array_get(const LertaArray *array, int64_t index) {
  int64_t item;
  lerta_array_read(array, index, &item);
  return item;
}

void lerta_array_set(LertaArray *array, int64_t index, int64_t item) {
  lerta_array_write(array, index, &item);
}

void lerta_array_push(LertaArray *array, int64_t item) { lerta_array_append(array, &item); }

int64_t lerta_array_pop(LertaArray *array) {
  int64_t item;
  lerta_array_take_last(array, &item);
  return item;
}

LertaString *lerta_string_join(const LertaArray *strings, const LertaString *separator) {
  int64_t length = 0;
  for (int64_t i = 0; i < strings->length; i++) {
    length += ((const LertaString *)(intptr_t)LERTA_WORD_ITEM(strings, i))->length;
  }
  if (strings->length > 0) length += separator->length * (strings->length - 1);
  LertaString *result = lerta_string_new(length);
  int64_t offset = 0;
  for (int64_t i = 0; i < strings->length; i++) {
    if (i > 0) {
      memcpy(result->bytes + offset, separator->bytes, (size_t)separator->length);
      offset += separator->length;
    }
    const LertaString *part = (const LertaString *)(intptr_t)LERTA_WORD_ITEM(strings, i);
    memcpy(result->bytes + offset, part->bytes, (size_t)part->length);
    offset += part->length;
  }
  return result;
}

bool lerta_array_equals(const LertaArray *a, const LertaArray *b, LertaEquals equals) {
  if (a->length != b->length) return false;
  for (int64_t i = 0; i < a->length; i++) {
    if (!equals(LERTA_WORD_ITEM(a, i), LERTA_WORD_ITEM(b, i))) return false;
  }
  return true;
}

uint64_t lerta_array_hash(const LertaArray *array, LertaHash hash) {
  uint64_t result = (uint64_t)array->length;
  for (int64_t i = 0; i < array->length; i++) {
    result = result * 31 + hash(LERTA_WORD_ITEM(array, i));
  }
  return result;
}
