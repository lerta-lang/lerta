#include <stdlib.h>
#include <string.h>

#include "internal.h"

// The entry module's top-level code, which the compiler generates (see
// docs/internals/architecture.md#per-module-output); the runtime wraps it with setup and exit.
void lerta_main(void);

LertaException lerta_exception = {NULL, NULL};

static LertaString *message_of(void *data, void *const *itab) {
  LertaString *(*message)(void *error) = (LertaString * (*)(void *)) itab[0];
  return message(data);
}

LertaString *lerta_exception_message(void) {
  return message_of(lerta_exception.data, lerta_exception.itab);
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

// `  at f (main.lerta:3:5)`
static void write_trace_entry(const LertaTraceSite *site) {
  lerta_stderr_write_text("  at ");
  lerta_stderr_write_string(site->function);
  lerta_stderr_write_text(" (");
  lerta_stderr_write_string(site->file);
  lerta_stderr_write_text(":");
  lerta_stderr_write_int(site->line);
  lerta_stderr_write_text(":");
  lerta_stderr_write_int(site->column);
  lerta_stderr_write_text(")\n");
}

// The entries kept of the trace of the exception, if it is the one that the trace is of, innermost
// first, with how many are left out between the two ends.
static void write_trace(void *exception) {
  if (trace_owner != exception) return;
  int64_t first_end = trace_count <= TRACE_KEPT ? trace_count : TRACE_ENDS;
  for (int64_t i = 0; i < first_end; i++) write_trace_entry(trace_entries[i]);
  if (trace_count <= TRACE_KEPT) return;
  lerta_stderr_write_text("  ... ");
  lerta_stderr_write_int(trace_count - TRACE_KEPT);
  lerta_stderr_write_text(" more\n");
  for (int64_t i = trace_count - TRACE_ENDS; i < trace_count; i++) {
    write_trace_entry(trace_entries[trace_slot(i)]);
  }
}

// The prefix, the pending exception's message and its trace, after what the buffer of output holds.
static void write_exception(const char *prefix, bool panicking) {
  LertaString *message = lerta_exception_message();
  lerta_output_flush_at_end(panicking);
  lerta_stderr_write_text(prefix);
  lerta_stderr_write_string(message);
  lerta_stderr_write_text("\n");
  write_trace(lerta_exception.data);
  if (lerta_is_late_nan(lerta_exception.data)) {
    lerta_stderr_write_text(
        "  hint: the NaN may have been made earlier; --eager-nan-checks reports where\n");
  }
}

void lerta_print_trace(void *data, void *const *itab) {
  LertaString *message = message_of(data, itab);
  lerta_output_flush();
  lerta_stderr_write_string(message);
  lerta_stderr_write_text("\n");
  write_trace(data);
  lerta_release(message);
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
  lerta_hash_init();
  lerta_set_arguments(argc, argv);
  lerta_output_init();
  lerta_main();
  if (lerta_exception.data != NULL) lerta_exit_with_exception();
  bool flushed = lerta_output_flush_at_end(false);
  lerta_release_kept();
  if (lerta_report_leaks()) return LERTA_LEAK_EXIT_CODE;
  return flushed ? 0 : 1;
}
