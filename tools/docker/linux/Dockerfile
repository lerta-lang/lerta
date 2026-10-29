# Linux for the tests, of Docker's own architecture: make, and clang for the generated code and the
# runtime. On x86-64, the 32-bit C library lets the tests also build and run 32-bit programs, which
# the host runs as they are.
FROM debian:trixie-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends make clang \
  && if [ "$(dpkg --print-architecture)" = amd64 ]; then \
    apt-get install -y --no-install-recommends gcc-multilib; fi \
  && rm -rf /var/lib/apt/lists/*
