#include <stdlib.h>
#include <string.h>

#include "lerta.h"

// A slot of the hash index is the position of an entry, or EMPTY. A removed entry stays in place
// (not live) until the entries are compacted, so probes pass over it.
#define EMPTY (-1)

static uint64_t hash_key(const LertaMap *map, int64_t key) {
  // The splitmix64 finalizer, so that the low bits, which pick the slot, depend on every bit.
  if (!map->string_keys) {
    uint64_t hash = (uint64_t)key;
    hash = (hash ^ (hash >> 30)) * 0xBF58476D1CE4E5B9u;
    hash = (hash ^ (hash >> 27)) * 0x94D049BB133111EBu;
    return hash ^ (hash >> 31);
  }
  const LertaString *s = (const LertaString *)(intptr_t)key;
  uint64_t hash = 0xCBF29CE484222325u;
  for (int64_t i = 0; i < s->length; i++) hash = (hash ^ s->bytes[i]) * 0x100000001B3u;
  return hash;
}

static bool same_key(const LertaMap *map, int64_t a, int64_t b) {
  if (!map->string_keys) return a == b;
  return lerta_string_equals((const LertaString *)(intptr_t)a, (const LertaString *)(intptr_t)b);
}

static void release_entry(const LertaMap *map, const LertaMapEntry *entry) {
  if (map->string_keys) lerta_release((void *)(intptr_t)entry->key);
  if (map->owns_values) lerta_release((void *)(intptr_t)entry->value);
}

static void drop_map(void *object) {
  LertaMap *map = object;
  for (int64_t i = 0; i < map->entry_count; i++) {
    if (map->entries[i].live) release_entry(map, &map->entries[i]);
  }
  free(map->entries);
  free(map->slots);
}

LertaMap *lerta_map_new(bool string_keys, bool owns_values) {
  LertaMap *map = lerta_alloc((int64_t)sizeof(LertaMap), drop_map);
  map->length = 0;
  map->entry_count = 0;
  map->entry_capacity = 0;
  map->entries = NULL;
  map->slot_count = 0;
  map->slots = NULL;
  map->string_keys = string_keys;
  map->owns_values = owns_values;
  return map;
}

int64_t lerta_map_length(const LertaMap *map) { return map->length; }

// The slot that holds the live entry with the key, or EMPTY's slot where it would go.
static int64_t find_slot(const LertaMap *map, int64_t key, uint64_t hash) {
  uint64_t mask = (uint64_t)map->slot_count - 1;
  for (uint64_t i = hash & mask;; i = (i + 1) & mask) {
    int64_t position = map->slots[i];
    if (position == EMPTY) return (int64_t)i;
    const LertaMapEntry *entry = &map->entries[position];
    if (entry->live && entry->hash == hash && same_key(map, entry->key, key)) return (int64_t)i;
  }
}

static void *checked_alloc(size_t size) {
  void *memory = malloc(size);
  if (memory == NULL) lerta_panic("out of memory");
  return memory;
}

// Drops the removed entries and rebuilds the index with room for twice the live ones.
static void grow(LertaMap *map) {
  int64_t live = 0;
  for (int64_t i = 0; i < map->entry_count; i++) {
    if (map->entries[i].live) map->entries[live++] = map->entries[i];
  }
  map->entry_count = live;
  int64_t capacity = 8;
  while (capacity < live * 2) capacity *= 2;
  LertaMapEntry *entries = realloc(map->entries, (size_t)capacity * sizeof(LertaMapEntry));
  if (entries == NULL) lerta_panic("out of memory");
  map->entries = entries;
  map->entry_capacity = capacity;
  // At most half the slots are used, so that probes stay short and always end.
  free(map->slots);
  map->slot_count = capacity * 2;
  map->slots = checked_alloc((size_t)map->slot_count * sizeof(int64_t));
  for (int64_t i = 0; i < map->slot_count; i++) map->slots[i] = EMPTY;
  for (int64_t i = 0; i < live; i++) {
    map->slots[find_slot(map, map->entries[i].key, map->entries[i].hash)] = i;
  }
}

bool lerta_map_get(const LertaMap *map, int64_t key, int64_t *value) {
  *value = 0;
  if (map->length == 0) return false;
  int64_t position = map->slots[find_slot(map, key, hash_key(map, key))];
  if (position == EMPTY) return false;
  *value = map->entries[position].value;
  if (map->owns_values) lerta_retain((void *)(intptr_t)*value);
  return true;
}

// The new value is retained before the old one is released, in case they are the same object.
void lerta_map_set(LertaMap *map, int64_t key, int64_t value) {
  if (map->owns_values) lerta_retain((void *)(intptr_t)value);
  uint64_t hash = hash_key(map, key);
  if (map->entry_count > 0) {
    int64_t position = map->slots[find_slot(map, key, hash)];
    if (position != EMPTY) {
      LertaMapEntry *entry = &map->entries[position];
      int64_t old = entry->value;
      entry->value = value;
      if (map->owns_values) lerta_release((void *)(intptr_t)old);
      return;
    }
  }
  if (map->entry_count == map->entry_capacity) grow(map);
  if (map->string_keys) lerta_retain((void *)(intptr_t)key);
  int64_t position = map->entry_count++;
  map->entries[position] = (LertaMapEntry){key, value, hash, true};
  map->slots[find_slot(map, key, hash)] = position;
  map->length++;
}

void lerta_map_remove(LertaMap *map, int64_t key) {
  if (map->length == 0) return;
  int64_t position = map->slots[find_slot(map, key, hash_key(map, key))];
  if (position == EMPTY) return;
  LertaMapEntry *entry = &map->entries[position];
  entry->live = false;
  map->length--;
  release_entry(map, entry);
}

LertaArray *lerta_map_keys(const LertaMap *map) {
  LertaArray *keys = lerta_array_new(map->string_keys);
  for (int64_t i = 0; i < map->entry_count; i++) {
    if (map->entries[i].live) lerta_array_push(keys, map->entries[i].key);
  }
  return keys;
}
