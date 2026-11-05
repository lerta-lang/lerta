// Linked into each program of test/runtime on Windows, where the C runtime would write printf's
// "\n" as "\r\n".
#include <fcntl.h>
#include <io.h>
#include <stdio.h>

__attribute__((constructor)) static void binary_stdout(void) {
  _setmode(_fileno(stdout), _O_BINARY);
}
