#include <stdlib.h>
#include <string.h>

#include "internal.h"

// The entry module's top-level code, which the compiler generates (see
// docs/internals.md#per-module-output); the runtime wraps it with setup and exit.
void lerta_main(void);

LertaException lerta_exception = {NULL, NULL};

LertaString *lerta_exception_message(void) {
  LertaString *(*message)(void *error) = (LertaString * (*)(void *)) lerta_exception.itab[0];
  return message(lerta_exception.data);
}

// The trace keeps the first TRACE_ENDS sites pushed, then the last TRACE_ENDS in a ring, so that
// an exception out of a deep recursion keeps both ends of its way.
enum { TRACE_ENDS = 32, TRACE_KEPT = 2 * TRACE_ENDS };

struct LertaTrace {
  // The exception's data, which the trace is of.
  void *owner;
  // The entries added, of which no more than TRACE_KEPT are kept.
  int64_t count;
  const LertaTraceSite *entries[];
};

static void *trace_owner = NULL;
static int64_t trace_count = 0;
static const LertaTraceSite *trace_entries[TRACE_KEPT];

static int64_t trace_slot(int64_t i) {
  return i < TRACE_ENDS ? i : TRACE_ENDS + (i - TRACE_ENDS) % TRACE_ENDS;
}

static int64_t kept_entries(int64_t count) {
  return count < TRACE_KEPT ? count : TRACE_KEPT;
}

// Kept out of line, as lerta_trace_start is, since a program calls it from every site and seldom
// runs it.
__attribute__((noinline, cold)) void lerta_trace_push(const LertaTraceSite *site) {
  if (trace_owner != lerta_exception.data) {
    lerta_trace_start(site);
    return;
  }
  trace_entries[trace_slot(trace_count++)] = site;
}

__attribute__((noinline, cold)) void lerta_trace_start(const LertaTraceSite *site) {
  trace_owner = lerta_exception.data;
  trace_entries[0] = site;
  trace_count = 1;
}

void lerta_trace_forget(void *object) {
  if (object == trace_owner) trace_owner = NULL;
}

LertaTrace *lerta_trace_save(void) {
  size_t kept = (size_t)kept_entries(trace_count) * sizeof(trace_entries[0]);
  LertaTrace *saved = lerta_checked_malloc(sizeof(LertaTrace) + kept);
  // A trace of another exception is of none for this one, which the copy may outlive.
  saved->owner = trace_owner == lerta_exception.data ? trace_owner : NULL;
  saved->count = trace_count;
  memcpy(saved->entries, trace_entries, kept);
  return saved;
}

void lerta_trace_load(const LertaTrace *saved) {
  trace_owner = saved->owner;
  trace_count = saved->count;
  size_t kept = (size_t)kept_entries(saved->count) * sizeof(trace_entries[0]);
  memcpy(trace_entries, saved->entries, kept);
}

void lerta_trace_restore(LertaTrace *saved) {
  lerta_trace_load(saved);
  free(saved);
}

void lerta_trace_free(LertaTrace *saved) {
  free(saved);
}

static void write_text(const char *text) {
  lerta_stderr_write((const uint8_t *)text, (int64_t)strlen(text));
}

static void write_string(const LertaString *s) {
  lerta_stderr_write(s->bytes, s->length);
}

static void write_int(int64_t n) {
  uint8_t buffer[LERTA_INT_TEXT_MAX];
  int64_t start = lerta_format_int(n, buffer);
  lerta_stderr_write(buffer + start, LERTA_INT_TEXT_MAX - start);
}

// `  at f (main.lerta:3:5)`
static void write_trace_entry(const LertaTraceSite *site) {
  write_text("  at ");
  write_string(site->function);
  write_text(" (");
  write_string(site->file);
  write_text(":");
  write_int(site->line);
  write_text(":");
  write_int(site->column);
  write_text(")\n");
}

// The entries kept of the pending exception's trace, innermost first, with how many are left out
// between the two ends.
static void write_trace(void) {
  if (trace_owner != lerta_exception.data) return;
  int64_t first_end = trace_count <= TRACE_KEPT ? trace_count : TRACE_ENDS;
  for (int64_t i = 0; i < first_end; i++) write_trace_entry(trace_entries[i]);
  if (trace_count <= TRACE_KEPT) return;
  write_text("  ... ");
  write_int(trace_count - TRACE_KEPT);
  write_text(" more\n");
  for (int64_t i = trace_count - TRACE_ENDS; i < trace_count; i++) {
    write_trace_entry(trace_entries[trace_slot(i)]);
  }
}

// The prefix, the pending exception's message and its trace, after what the buffer of output holds.
static void write_exception(const char *prefix, bool panicking) {
  LertaString *message = lerta_exception_message();
  lerta_output_flush_at_end(panicking);
  write_text(prefix);
  write_string(message);
  write_text("\n");
  write_trace();
}

_Noreturn void lerta_exit_with_exception(void) {
  write_exception("", false);
  lerta_os_exit(1);
}

_Noreturn void lerta_panic_with_exception(const char *prefix) {
  write_exception(prefix, true);
  lerta_os_abort();
}

void lerta_check_comparison(void) {
  if (lerta_exception.data != NULL) {
    lerta_panic_with_exception("equals, compare or hash threw an exception: ");
  }
}

int main(int argc, char **argv) {
  lerta_stack_init();
  lerta_set_arguments(argc, argv);
  lerta_output_init();
  lerta_main();
  if (lerta_exception.data != NULL) lerta_exit_with_exception();
  bool flushed = lerta_output_flush_at_end(false);
  if (lerta_report_leaks()) return LERTA_LEAK_EXIT_CODE;
  return flushed ? 0 : 1;
}
