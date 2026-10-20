// A deinit sets the count to 1 while it runs (see lerta_run_deinit).
#include "lerta.h"

static void deinit(void *object) { (void)object; }
static void drop_with_deinit(void *object) { lerta_run_deinit(object, deinit); }
static const LertaType with_deinit = {drop_with_deinit, NULL, NULL};

void lerta_main(void) {
  void *object = lerta_new(16, &with_deinit);
  lerta_release(object);
  lerta_release(object);
}
