// Removes the tree that LERTA_TEST_TREE names, which holds a symbolic link that must not be
// followed, and a directory deeper than the descriptors that the program is let open.
#include <stdlib.h>
#include <unistd.h>
#ifndef _WIN32
#include <sys/resource.h>
#endif
#include "internal.h"

void lerta_main(void) {
#ifndef _WIN32
  struct rlimit limit = { .rlim_cur = 32, .rlim_max = 32 };
  if (setrlimit(RLIMIT_NOFILE, &limit) != 0) _exit(2);
#endif
  if (!lerta_os_remove_tree(getenv("LERTA_TEST_TREE"))) _exit(1);
}
