# How Windows builds the runtime, which make includes and compiler/platform_description.lerta
# reads: the runtime's platform_*.c files, relative to runtime/, and libuv's (third_party/libuv,
# v1.53.0) source files, relative to its root, the flags of the compiler for those and the
# libraries to link with, from its CMakeLists.txt, a word on each line.

PLATFORM_SOURCES := \
  platform_windows.c

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
  src/win/async.c \
  src/win/core.c \
  src/win/detect-wakeup.c \
  src/win/dl.c \
  src/win/error.c \
  src/win/fs.c \
  src/win/fs-event.c \
  src/win/getaddrinfo.c \
  src/win/getnameinfo.c \
  src/win/handle.c \
  src/win/loop-watcher.c \
  src/win/pipe.c \
  src/win/thread.c \
  src/win/poll.c \
  src/win/process.c \
  src/win/process-stdio.c \
  src/win/signal.c \
  src/win/snprintf.c \
  src/win/stream.c \
  src/win/tcp.c \
  src/win/tty.c \
  src/win/udp.c \
  src/win/util.c \
  src/win/winapi.c \
  src/win/winsock.c

LIBUV_FLAGS := \
  -fno-strict-aliasing \
  -DWIN32_LEAN_AND_MEAN \
  -D_WIN32_WINNT=0x0A00 \
  -D_CRT_DECLARE_NONSTDC_NAMES=0

LIBUV_LIBRARIES := \
  psapi \
  user32 \
  advapi32 \
  iphlpapi \
  userenv \
  ws2_32 \
  dbghelp \
  ole32 \
  shell32 \
  synchronization
