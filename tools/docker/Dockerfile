# The environment that runs the tests on Linux: make, Node.js for the test scripts, and clang for
# the generated code and the runtime. On x86-64, the 32-bit C library lets the tests also build
# and run 32-bit programs, which the host runs as they are, and mingw-w64 and Wine let them build
# Windows programs, 64-bit and 32-bit, and run them.
FROM node:22-trixie
RUN if [ "$(dpkg --print-architecture)" = amd64 ]; then dpkg --add-architecture i386; fi \
  && apt-get update \
  && apt-get install -y --no-install-recommends clang \
  && if [ "$(dpkg --print-architecture)" = amd64 ]; then \
    apt-get install -y --no-install-recommends gcc-multilib mingw-w64 lld wine wine64 wine32:i386; \
  fi \
  && rm -rf /var/lib/apt/lists/*
# Without these, Wine writes its own messages to the programs' stderr.
ENV WINEDEBUG=-all XDG_RUNTIME_DIR=/tmp/xdg
RUN if command -v wine >/dev/null; then \
    mkdir -m 700 "$XDG_RUNTIME_DIR" && wineboot --init && wineserver --wait; fi
