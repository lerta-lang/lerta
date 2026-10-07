#include <stdlib.h>
#include <string.h>

#include "lerta.h"

LERTA_STATIC_STRING(index_out_of_range, "index out of range");
LERTA_STATIC_STRING(pop_from_empty, "pop from an empty array");

static void drop_array(void *object) {
  LertaArray *array = object;
  if (array->owns_references) {
    for (int64_t i = 0; i < array->length; i++) lerta_release((void *)(intptr_t)array->items[i]);
  }
  free(array->items);
}

LertaArray *lerta_array_new(bool owns_references) {
  LertaArray *array = lerta_alloc((int64_t)sizeof(LertaArray), drop_array);
  array->length = 0;
  array->capacity = 0;
  array->items = NULL;
  array->owns_references = owns_references;
  return array;
}

int64_t lerta_array_length(const LertaArray *array) { return array->length; }

static void check_index(const LertaArray *array, int64_t index) {
  if (index < 0 || index >= array->length) lerta_throw((const LertaString *)&index_out_of_range);
}

static void retain_item(const LertaArray *array, int64_t item) {
  if (array->owns_references) lerta_retain((void *)(intptr_t)item);
}

int64_t lerta_array_get(const LertaArray *array, int64_t index) {
  check_index(array, index);
  int64_t item = array->items[index];
  retain_item(array, item);
  return item;
}

// The new item is retained before the old one is released, in case they are the same object.
void lerta_array_set(LertaArray *array, int64_t index, int64_t item) {
  check_index(array, index);
  retain_item(array, item);
  int64_t old = array->items[index];
  array->items[index] = item;
  if (array->owns_references) lerta_release((void *)(intptr_t)old);
}

void lerta_array_push(LertaArray *array, int64_t item) {
  if (array->length == array->capacity) {
    int64_t capacity = array->capacity == 0 ? 4 : array->capacity * 2;
    int64_t *items = realloc(array->items, (size_t)capacity * sizeof(int64_t));
    if (items == NULL) lerta_panic("out of memory");
    array->items = items;
    array->capacity = capacity;
  }
  retain_item(array, item);
  array->items[array->length++] = item;
}

// The array's reference to the item passes to the caller.
int64_t lerta_array_pop(LertaArray *array) {
  if (array->length == 0) lerta_throw((const LertaString *)&pop_from_empty);
  return array->items[--array->length];
}

LertaString *lerta_string_join(const LertaArray *strings, const LertaString *separator) {
  int64_t length = 0;
  for (int64_t i = 0; i < strings->length; i++) {
    length += ((const LertaString *)(intptr_t)strings->items[i])->length;
  }
  if (strings->length > 0) length += separator->length * (strings->length - 1);
  LertaString *result = lerta_alloc((int64_t)sizeof(LertaString) + length, NULL);
  result->length = length;
  int64_t offset = 0;
  for (int64_t i = 0; i < strings->length; i++) {
    if (i > 0) {
      memcpy(result->bytes + offset, separator->bytes, (size_t)separator->length);
      offset += separator->length;
    }
    const LertaString *part = (const LertaString *)(intptr_t)strings->items[i];
    memcpy(result->bytes + offset, part->bytes, (size_t)part->length);
    offset += part->length;
  }
  return result;
}
