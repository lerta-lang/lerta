#include <signal.h>

#include <uv.h>

#include "internal.h"

// The signals that ask a program to end cancel its top-level code (see
// docs/reference/functions.md#signals). Windows has no SIGTERM to send, and gives Ctrl-Break and
// the closing of the console as SIGBREAK and SIGHUP.
#ifdef _WIN32
static const int ending_signals[] = {SIGINT, SIGBREAK, SIGHUP};
#else
static const int ending_signals[] = {SIGINT, SIGTERM, SIGHUP};
#endif
enum { ENDING_SIGNAL_COUNT = sizeof ending_signals / sizeof ending_signals[0] };

static uv_signal_t handles[ENDING_SIGNAL_COUNT];
static bool watched[ENDING_SIGNAL_COUNT];
static LertaPromise *watched_promise = NULL;
static int received_signal = 0;

// Stopped, a signal takes its default action again, so that a second one ends the program at once.
static void stop_watching(void) {
  for (int i = 0; i < ENDING_SIGNAL_COUNT; i++) {
    if (watched[i]) uv_close((uv_handle_t *)&handles[i], NULL);
    watched[i] = false;
  }
}

void lerta_signals_unwatch(void) { stop_watching(); }

static void on_ending_signal(uv_signal_t *handle, int signal_number) {
  (void)handle;
  received_signal = signal_number;
  stop_watching();
  lerta_promise_cancel(watched_promise);
}

// A signal that the parent ignores, as nohup does SIGHUP, stays ignored. The handles do not keep
// the loop running.
void lerta_signals_watch(LertaPromise *top_level) {
  watched_promise = top_level;
  uv_loop_t *loop = uv_default_loop();
  for (int i = 0; i < ENDING_SIGNAL_COUNT; i++) {
    if (lerta_os_signal_ignored(ending_signals[i])) continue;
    uv_signal_init(loop, &handles[i]);
    if (uv_signal_start(&handles[i], on_ending_signal, ending_signals[i]) != 0) {
      uv_close((uv_handle_t *)&handles[i], NULL);
      continue;
    }
    uv_unref((uv_handle_t *)&handles[i]);
    watched[i] = true;
  }
}

int lerta_signal_received(void) { return received_signal; }

_Noreturn void lerta_end_by_signal(void) {
  lerta_output_flush_at_end(false);
  lerta_os_end_by_signal(received_signal);
}
