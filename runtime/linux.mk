# How Linux builds the runtime, which make includes and compiler/platform_description.lerta
# reads: the runtime's platform_*.c files, relative to runtime/, and libuv's (third_party/libuv,
# v1.53.0) source files, relative to its root, the flags of the compiler for those and the
# libraries to link with, from its CMakeLists.txt, a word on each line.

PLATFORM_SOURCES := \
  platform_posix.c

LIBUV_SOURCES := \
  src/fs-poll.c \
  src/idna.c \
  src/inet.c \
  src/random.c \
  src/strscpy.c \
  src/strtok.c \
  src/thread-common.c \
  src/threadpool.c \
  src/timer.c \
  src/uv-common.c \
  src/uv-data-getter-setters.c \
  src/version.c \
  src/unix/async.c \
  src/unix/core.c \
  src/unix/dl.c \
  src/unix/fs.c \
  src/unix/getaddrinfo.c \
  src/unix/getnameinfo.c \
  src/unix/loop-watcher.c \
  src/unix/loop.c \
  src/unix/pipe.c \
  src/unix/poll.c \
  src/unix/process.c \
  src/unix/random-devurandom.c \
  src/unix/signal.c \
  src/unix/stream.c \
  src/unix/tcp.c \
  src/unix/thread.c \
  src/unix/tty.c \
  src/unix/udp.c \
  src/unix/proctitle.c \
  src/unix/linux.c \
  src/unix/procfs-exepath.c \
  src/unix/random-getrandom.c \
  src/unix/random-sysctl-linux.c

LIBUV_FLAGS := \
  -fno-strict-aliasing \
  -D_FILE_OFFSET_BITS=64 \
  -D_LARGEFILE_SOURCE \
  -D_GNU_SOURCE \
  -D_POSIX_C_SOURCE=200112

LIBUV_LIBRARIES := \
  pthread \
  dl \
  rt
