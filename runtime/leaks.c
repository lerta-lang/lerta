// The debug runtime's leak check (see docs/internals.md#leak-checking). It runs as the program ends
// and spends the counts of the objects alive, which nothing may use after it.
#include <stdlib.h>
#include <string.h>

#include "internal.h"

#ifdef LERTA_DEBUG
// The objects alive, in the order they were made.
static LertaPrefix live = {&live, &live};
// How many objects and frames of coroutines are alive.
static int64_t live_count = 0;

void lerta_track(LertaPrefix *prefix) {
  live_count++;
  prefix->previous = live.previous;
  prefix->next = &live;
  live.previous->next = prefix;
  live.previous = prefix;
}

void lerta_untrack(LertaPrefix *prefix) {
  live_count--;
  prefix->previous->next = prefix->next;
  prefix->next->previous = prefix->previous;
}

void lerta_track_frame(void) { live_count++; }

void lerta_untrack_frame(void) { live_count--; }

static LertaHeader *object_of(LertaPrefix *prefix) { return (LertaHeader *)(prefix + 1); }

static void uncount(void *reference) {
  LertaHeader *object = reference;
  if (object != NULL && object->ref_count != LERTA_IMMORTAL) object->ref_count--;
}

static LertaHeader **reached = NULL;
static int64_t reached_length = 0;
static int64_t reached_capacity = 0;

// Marks the object as held, with a count of 1, the first time it is reached.
static void reach(void *reference) {
  LertaHeader *object = reference;
  if (object == NULL || object->ref_count == LERTA_IMMORTAL || object->ref_count > 0) return;
  object->ref_count = 1;
  if (reached_length == reached_capacity) {
    reached_capacity = reached_capacity == 0 ? 64 : reached_capacity * 2;
    reached = lerta_checked_realloc(reached, (size_t)reached_capacity * sizeof(LertaHeader *));
  }
  reached[reached_length++] = object;
}

// An object that has no type holds nothing.
static void visit_object(LertaHeader *object, LertaVisitor visitor) {
  if (object->type != NULL) object->type->visit(object, visitor);
}

// Leaves the count of each object alive above 0 if what holds it from outside the objects, as a
// local, a top-level value or the runtime, holds it or an object that holds it in turn, and at most
// 0 if only objects that nothing outside holds keep it alive, as a cycle does.
static void count_holders_outside(void) {
  for (LertaPrefix *p = live.next; p != &live; p = p->next) visit_object(object_of(p), uncount);
  for (LertaPrefix *p = live.next; p != &live; p = p->next) {
    LertaHeader *object = object_of(p);
    if (object->ref_count <= 0) continue;
    object->ref_count = 0;
    reach(object);
  }
  // Those queued to be dropped, as when a deinit exits, are not leaked.
  lerta_visit_pending(reach);
  while (reached_length > 0) visit_object(reached[--reached_length], reach);
}

LERTA_STATIC_STRING(string_name, "String or Binary");

static const LertaString *name_of(LertaHeader *object) {
  if (object->type == NULL) return (const LertaString *)&string_name;
  return object->type->name;
}

static bool same_name(const LertaString *a, const LertaString *b) {
  return a->length == b->length && memcmp(a->bytes, b->bytes, (size_t)a->length) == 0;
}

typedef struct {
  const LertaString *name;
  int64_t count;
} NameCount;

// Reports the objects that nothing outside the objects holds, by the names of their types, in the
// order the first of each was made, and returns how many there are.
static int64_t report_unreachable(void) {
  count_holders_outside();
  NameCount *names = NULL;
  int64_t name_count = 0;
  int64_t unreachable = 0;
  for (LertaPrefix *p = live.next; p != &live; p = p->next) {
    LertaHeader *object = object_of(p);
    if (object->ref_count > 0) continue;
    unreachable++;
    const LertaString *name = name_of(object);
    int64_t i = 0;
    while (i < name_count && !same_name(names[i].name, name)) i++;
    if (i == name_count) {
      names = lerta_checked_realloc(names, (size_t)(name_count + 1) * sizeof(NameCount));
      names[name_count++] = (NameCount){name, 0};
    }
    names[i].count++;
  }
  if (unreachable > 0) {
    lerta_stderr_write_text("leak: ");
    lerta_stderr_write_int(unreachable);
    lerta_stderr_write_text(" unreachable object(s): ");
    for (int64_t i = 0; i < name_count; i++) {
      if (i > 0) lerta_stderr_write_text(", ");
      lerta_stderr_write_string(names[i].name);
      lerta_stderr_write_text(" (");
      lerta_stderr_write_int(names[i].count);
      lerta_stderr_write_text(")");
    }
    lerta_stderr_write_text("\n");
  }
  free(names);
  return unreachable;
}
#endif

bool lerta_report_leaks(void) {
#ifdef LERTA_DEBUG
  int64_t unreachable = report_unreachable();
  int64_t held = live_count - unreachable;
  if (held == 0) return unreachable > 0;
  lerta_stderr_write_text("leak: ");
  lerta_stderr_write_int(held);
  lerta_stderr_write_text(" object(s)\n");
  return true;
#else
  return false;
#endif
}

bool lerta_report_unreachable(void) {
#ifdef LERTA_DEBUG
  return report_unreachable() > 0;
#else
  return false;
#endif
}
