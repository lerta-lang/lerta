// The parent's drop releases its child twice: the first release queues it, as the parent is being
// dropped, and the second finds it there.
#include "lerta.h"

static void drop_parent(void *parent) {
  void *child = ((void **)parent)[2];
  lerta_release(child);
  lerta_release(child);
}
static const LertaType parent_type = {drop_parent, NULL, NULL};

void lerta_main(void) {
  void **parent = lerta_new(24, &parent_type);
  parent[2] = lerta_new(16, NULL);
  lerta_release(parent);
}
