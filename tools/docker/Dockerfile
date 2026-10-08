# The environment that runs the tests on Linux: Node.js for stage0 and the scripts, and clang for
# the generated code and the runtime. On x86-64, the 32-bit C library lets the tests also build
# and run 32-bit programs, which the host runs as they are.
FROM node:22-trixie
RUN apt-get update \
  && apt-get install -y --no-install-recommends clang \
  && if [ "$(dpkg --print-architecture)" = amd64 ]; then \
    apt-get install -y --no-install-recommends gcc-multilib; fi \
  && rm -rf /var/lib/apt/lists/*
