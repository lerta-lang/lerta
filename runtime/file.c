#include <stdlib.h>
#include <string.h>

#include "internal.h"

LERTA_STATIC_STRING(cannot_read, "cannot read file: ");
LERTA_STATIC_STRING(cannot_write, "cannot write file: ");
LERTA_STATIC_STRING(cannot_resolve, "cannot resolve path: ");
LERTA_STATIC_STRING(cannot_make_temp_dir, "cannot make a temporary directory");
LERTA_STATIC_STRING(cannot_remove, "cannot remove: ");
LERTA_STATIC_STRING(cannot_make_dir, "cannot make directory: ");
LERTA_STATIC_STRING(cannot_rename, "cannot rename: ");
LERTA_STATIC_STRING(cannot_list, "cannot list directory: ");
LERTA_STATIC_STRING(name_not_utf8, "a name is not valid UTF-8 in the directory: ");

LertaString *lerta_read_file(const LertaString *path) {
  char *name = lerta_c_string(path);
  LertaString *contents = name == NULL ? NULL : lerta_os_read_file(name);
  free(name);
  if (contents == NULL) lerta_raise_with(LERTA_IO_ERROR, &cannot_read, path);
  return contents;
}

void lerta_write_file(const LertaString *path, const LertaString *data) {
  char *name = lerta_c_string(path);
  bool written = name != NULL && lerta_os_write_file(name, data->bytes, data->length);
  free(name);
  if (!written) lerta_raise_with(LERTA_IO_ERROR, &cannot_write, path);
}

bool lerta_is_file(const LertaString *path) {
  char *name = lerta_c_string(path);
  bool is_file = name != NULL && lerta_os_is_file(name);
  free(name);
  return is_file;
}

bool lerta_is_dir(const LertaString *path) {
  char *name = lerta_c_string(path);
  bool is_dir = name != NULL && lerta_os_is_dir(name);
  free(name);
  return is_dir;
}

// An item takes 8 bytes even where a pointer takes 4, and holds its reference in its first bytes.
static const LertaString *string_item(const void *item) {
  const LertaString *string;
  memcpy(&string, item, sizeof string);
  return string;
}

// In the order of their bytes, as String.compare gives.
static int compare_strings(const void *a, const void *b) {
  const LertaString *left = string_item(a);
  const LertaString *right = string_item(b);
  int64_t common = left->length < right->length ? left->length : right->length;
  int order = memcmp(left->bytes, right->bytes, (size_t)common);
  if (order != 0) return order;
  return (left->length > right->length) - (left->length < right->length);
}

static bool are_utf8(const LertaArray *strings) {
  int64_t size = lerta_item_size(strings->item_kind);
  for (int64_t i = 0; i < strings->length; i++) {
    if (!lerta_is_utf8(string_item(strings->items + i * size))) return false;
  }
  return true;
}

// An empty path is refused here, as Windows would read `\*` in it as the root of the drive.
LertaArray *lerta_list_dir(const LertaString *path) {
  char *name = lerta_c_string(path);
  LertaArray *names = lerta_array_create(LERTA_REFERENCE_ITEMS);
  bool listed = name != NULL && name[0] != '\0' && lerta_os_list_dir(name, names);
  free(name);
  if (!listed) {
    lerta_release(names);
    lerta_raise_with(LERTA_IO_ERROR, &cannot_list, path);
    return NULL;
  }
  if (!are_utf8(names)) {
    lerta_release(names);
    lerta_raise_with(LERTA_VALUE_ERROR, &name_not_utf8, path);
    return NULL;
  }
  size_t size = (size_t)lerta_item_size(names->item_kind);
  qsort(names->items, (size_t)names->length, size, compare_strings);
  return names;
}

void lerta_append_c_string(LertaArray *array, const char *text) {
  LertaString *string = lerta_string_from_bytes(text, (int64_t)strlen(text));
  lerta_array_append(array, &string);
  lerta_release(string);
}

// Takes a C string that the platform allocated.
static LertaString *string_from_os(char *text) {
  LertaString *result = lerta_string_from_bytes(text, (int64_t)strlen(text));
  free(text);
  return result;
}

LertaString *lerta_real_path(const LertaString *path) {
  char *name = lerta_c_string(path);
  char *resolved = name == NULL ? NULL : lerta_os_real_path(name);
  free(name);
  if (resolved == NULL) {
    lerta_raise_with(LERTA_IO_ERROR, &cannot_resolve, path);
    return NULL;
  }
  return string_from_os(resolved);
}

LertaString *lerta_make_temp_dir(void) {
  char *path = lerta_os_make_temp_dir();
  if (path == NULL) {
    lerta_raise(LERTA_IO_ERROR, (const LertaString *)&cannot_make_temp_dir);
    return NULL;
  }
  return string_from_os(path);
}

void lerta_remove_tree(const LertaString *path) {
  char *name = lerta_c_string(path);
  bool removed = name != NULL && lerta_os_remove_tree(name);
  free(name);
  if (!removed) lerta_raise_with(LERTA_IO_ERROR, &cannot_remove, path);
}

// Each directory that ends before a separator is made first; only whether the whole path is a
// directory at the end decides, since a parent that cannot be made, such as a drive or a network
// share on Windows, may be there.
static bool make_dir_and_parents(char *path) {
  for (size_t i = 1; path[i] != '\0'; i++) {
    if (!lerta_os_is_separator(path[i]) || lerta_os_is_separator(path[i - 1])) continue;
    char separator = path[i];
    path[i] = '\0';
    lerta_os_make_dir(path);
    path[i] = separator;
  }
  return lerta_os_make_dir(path);
}

void lerta_make_dir(const LertaString *path) {
  char *name = lerta_c_string(path);
  bool made = name != NULL && name[0] != '\0' && make_dir_and_parents(name);
  free(name);
  if (!made) lerta_raise_with(LERTA_IO_ERROR, &cannot_make_dir, path);
}

void lerta_rename(const LertaString *from, const LertaString *to) {
  char *from_name = lerta_c_string(from);
  char *to_name = lerta_c_string(to);
  bool renamed = from_name != NULL && to_name != NULL && lerta_os_rename(from_name, to_name);
  free(from_name);
  free(to_name);
  if (!renamed) lerta_raise_with(LERTA_IO_ERROR, &cannot_rename, from);
}

// Reads in chunks, so that files whose size is not known in advance work too.
LertaString *lerta_read_chunks(int64_t (*read)(void *file, uint8_t *buffer, int64_t size),
                               void *file) {
  int64_t capacity = 4096;
  int64_t length = 0;
  uint8_t *bytes = lerta_checked_malloc((size_t)capacity);
  for (;;) {
    if (length == capacity) {
      capacity *= 2;
      if ((uint64_t)capacity > SIZE_MAX) lerta_panic("out of memory");
      bytes = lerta_checked_realloc(bytes, (size_t)capacity);
    }
    int64_t count = read(file, bytes + length, capacity - length);
    if (count == 0) break;
    if (count < 0) {
      free(bytes);
      return NULL;
    }
    length += count;
  }
  LertaString *result = lerta_string_from_bytes(bytes, length);
  free(bytes);
  return result;
}
