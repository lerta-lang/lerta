// A temporary directory made in a directory whose path is longer than the first buffer that the
// runtime reads the path into.
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

#include "internal.h"

void lerta_main(void) {
  enum { LEVELS = 2, LEVEL_LENGTH = 1 + 200 };
  char dir[512];
  // Two levels, as a name holds at most 255 bytes, each a separator and 200 bytes.
  if (getcwd(dir, sizeof dir - LEVELS * LEVEL_LENGTH) == NULL) _exit(1);
  for (int level = 0; level < LEVELS; level++) {
    strcat(dir, "/");
    size_t length = strlen(dir);
    memset(dir + length, 'd', 200);
    dir[length + 200] = '\0';
    if (mkdir(dir, 0777) != 0) _exit(1);
  }
  setenv("TMPDIR", dir, 1);
  char *made = lerta_os_make_temp_dir();
  if (made == NULL || strncmp(made, dir, strlen(dir)) != 0) _exit(1);
  struct stat status;
  if (stat(made, &status) != 0 || !S_ISDIR(status.st_mode)) _exit(1);
  free(made);
}
