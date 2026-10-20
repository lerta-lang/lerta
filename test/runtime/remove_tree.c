// Removes the tree that LERTA_TEST_TREE names, which holds a symbolic link that must not be
// followed.
#include <stdlib.h>
#include <unistd.h>
#include "internal.h"

void lerta_main(void) {
  if (!lerta_os_remove_tree(getenv("LERTA_TEST_TREE"))) _exit(1);
}
