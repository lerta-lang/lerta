#include <stdlib.h>
#include <string.h>

#include "lerta.h"

// A slot of the hash index is the position of an entry, or EMPTY. A removed entry stays in place
// (not live) until the entries are compacted, so probes pass over it.
#define EMPTY (-1)

// The splitmix64 finalizer, so that the low bits, which pick the slot, depend on every bit.
static uint64_t mix(uint64_t hash) {
  hash = (hash ^ (hash >> 30)) * 0xBF58476D1CE4E5B9u;
  hash = (hash ^ (hash >> 27)) * 0x94D049BB133111EBu;
  return hash ^ (hash >> 31);
}

static uint64_t hash_key(const LertaMap *map, int64_t key) {
  switch (map->key_kind) {
    case LERTA_STRING_KEYS: return lerta_string_hash((const LertaString *)(intptr_t)key);
    case LERTA_VALUE_KEYS: return mix(map->hash(key));
    default: return mix((uint64_t)key);
  }
}

static bool same_key(const LertaMap *map, int64_t a, int64_t b) {
  switch (map->key_kind) {
    case LERTA_STRING_KEYS:
      return lerta_string_equals((const LertaString *)(intptr_t)a,
                                 (const LertaString *)(intptr_t)b);
    case LERTA_VALUE_KEYS: return map->equals(a, b);
    default: return a == b;
  }
}

static bool keys_are_references(const LertaMap *map) {
  return map->key_kind != LERTA_INT_KEYS && map->key_kind != LERTA_BYTE_KEYS;
}

static size_t value_size(const LertaMap *map) { return (size_t)lerta_item_size(map->value_kind); }

// Rounded up to 8 bytes, so that each entry's key stays aligned after a value of one byte.
static size_t entry_size(const LertaMap *map) {
  return (sizeof(LertaMapEntry) + value_size(map) + 7) & ~(size_t)7;
}

static LertaMapEntry *entry_at(const LertaMap *map, int64_t position) {
  return (LertaMapEntry *)(map->entries + (size_t)position * entry_size(map));
}

static void *value_of(LertaMapEntry *entry) { return (uint8_t *)entry + sizeof(LertaMapEntry); }

static void release_entry(const LertaMap *map, LertaMapEntry *entry) {
  if (keys_are_references(map)) lerta_release((void *)(intptr_t)entry->key);
  lerta_release_item(map->value_kind, value_of(entry));
}

static void drop_map(void *object) {
  LertaMap *map = object;
  for (int64_t i = 0; i < map->entry_count; i++) {
    if (entry_at(map, i)->live) release_entry(map, entry_at(map, i));
  }
  free(map->entries);
  free(map->slots);
}

LertaMap *lerta_map_create(LertaKeyKind key_kind, LertaItemKind value_kind, LertaHash hash,
                           LertaEquals equals) {
  LertaMap *map = lerta_alloc((int64_t)sizeof(LertaMap), drop_map);
  map->length = 0;
  map->entry_count = 0;
  map->entry_capacity = 0;
  map->cursors = 0;
  map->entries = NULL;
  map->slot_count = 0;
  map->slots = NULL;
  map->key_kind = key_kind;
  map->value_kind = value_kind;
  map->hash = hash;
  map->equals = equals;
  return map;
}

int64_t lerta_map_length(const LertaMap *map) { return map->length; }

// The slot that holds the live entry with the key, or EMPTY's slot where it would go.
static int64_t find_slot(const LertaMap *map, int64_t key, uint64_t hash) {
  uint64_t mask = (uint64_t)map->slot_count - 1;
  for (uint64_t i = hash & mask;; i = (i + 1) & mask) {
    int64_t position = map->slots[i];
    if (position == EMPTY) return (int64_t)i;
    const LertaMapEntry *entry = entry_at(map, position);
    if (entry->live && entry->hash == hash && same_key(map, entry->key, key)) return (int64_t)i;
  }
}

// Drops the removed entries, unless a cursor needs the positions, and rebuilds the index with room
// for twice the entries kept.
static void grow(LertaMap *map) {
  if (map->cursors == 0) {
    int64_t live = 0;
    for (int64_t i = 0; i < map->entry_count; i++) {
      if (entry_at(map, i)->live) memmove(entry_at(map, live++), entry_at(map, i), entry_size(map));
    }
    map->entry_count = live;
  }
  int64_t kept = map->entry_count;
  int64_t capacity = 8;
  while (capacity < kept * 2) capacity *= 2;
  map->entries = lerta_checked_realloc(map->entries, (size_t)capacity * entry_size(map));
  map->entry_capacity = capacity;
  // At most half the slots are used, so that probes stay short and always end.
  free(map->slots);
  map->slot_count = capacity * 2;
  map->slots = lerta_checked_malloc((size_t)map->slot_count * sizeof(int64_t));
  for (int64_t i = 0; i < map->slot_count; i++) map->slots[i] = EMPTY;
  for (int64_t i = 0; i < kept; i++) {
    const LertaMapEntry *entry = entry_at(map, i);
    if (entry->live) map->slots[find_slot(map, entry->key, entry->hash)] = i;
  }
}

bool lerta_map_read(const LertaMap *map, int64_t key, void *value) {
  size_t size = value_size(map);
  memset(value, 0, size);
  if (map->length == 0) return false;
  int64_t position = map->slots[find_slot(map, key, hash_key(map, key))];
  if (position == EMPTY) return false;
  memcpy(value, value_of(entry_at(map, position)), size);
  lerta_retain_item(map->value_kind, value);
  return true;
}

// The new value is retained before the old one is released, in case they are the same object.
void lerta_map_write(LertaMap *map, int64_t key, const void *value) {
  lerta_retain_item(map->value_kind, value);
  size_t size = value_size(map);
  uint64_t hash = hash_key(map, key);
  if (map->entry_count > 0) {
    int64_t position = map->slots[find_slot(map, key, hash)];
    if (position != EMPTY) {
      void *entry_value = value_of(entry_at(map, position));
      LertaItem old;
      memcpy(&old, entry_value, size);
      memcpy(entry_value, value, size);
      lerta_release_item(map->value_kind, &old);
      return;
    }
  }
  if (map->entry_count == map->entry_capacity) grow(map);
  if (keys_are_references(map)) lerta_retain((void *)(intptr_t)key);
  int64_t position = map->entry_count++;
  LertaMapEntry *entry = entry_at(map, position);
  *entry = (LertaMapEntry){key, hash, true};
  memcpy(value_of(entry), value, size);
  map->slots[find_slot(map, key, hash)] = position;
  map->length++;
}

void lerta_map_remove(LertaMap *map, int64_t key) {
  if (map->length == 0) return;
  int64_t position = map->slots[find_slot(map, key, hash_key(map, key))];
  if (position == EMPTY) return;
  LertaMapEntry *entry = entry_at(map, position);
  entry->live = false;
  map->length--;
  release_entry(map, entry);
}

static LertaItemKind key_item_kind(const LertaMap *map) {
  if (keys_are_references(map)) return LERTA_REFERENCE_ITEMS;
  return map->key_kind == LERTA_BYTE_KEYS ? LERTA_BYTE_ITEMS : LERTA_PLAIN_ITEMS;
}

LertaArray *lerta_map_keys(const LertaMap *map) {
  LertaArray *keys = lerta_array_create(key_item_kind(map));
  for (int64_t i = 0; i < map->entry_count; i++) {
    const LertaMapEntry *entry = entry_at(map, i);
    if (entry->live) lerta_array_append_word(keys, entry->key);
  }
  return keys;
}

struct LertaMapCursor {
  LertaHeader header;
  LertaMap *map;
  int64_t position;
  int64_t end;
};

static void drop_cursor(void *object) {
  LertaMapCursor *cursor = object;
  cursor->map->cursors--;
  lerta_release(cursor->map);
}

LertaMapCursor *lerta_map_cursor(LertaMap *map) {
  LertaMapCursor *cursor = lerta_alloc((int64_t)sizeof(LertaMapCursor), drop_cursor);
  lerta_retain(map);
  map->cursors++;
  cursor->map = map;
  cursor->position = 0;
  cursor->end = map->entry_count;
  return cursor;
}

bool lerta_map_cursor_has_next(LertaMapCursor *cursor) {
  const LertaMap *map = cursor->map;
  while (cursor->position < cursor->end && !entry_at(map, cursor->position)->live) {
    cursor->position++;
  }
  return cursor->position < cursor->end;
}

void lerta_map_cursor_next(LertaMapCursor *cursor, int64_t *key, void *value) {
  const LertaMap *map = cursor->map;
  LertaMapEntry *entry = entry_at(map, cursor->position++);
  *key = entry->key;
  if (keys_are_references(map)) lerta_retain((void *)(intptr_t)entry->key);
  memcpy(value, value_of(entry), value_size(map));
  lerta_retain_item(map->value_kind, value);
}
