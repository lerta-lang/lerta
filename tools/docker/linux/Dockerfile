# Linux for the tests, of Docker's own architecture: make, and clang for the generated code and the
# runtime. On x86-64, the 32-bit C library lets the tests also build and run 32-bit programs, which
# the host runs as they are.
FROM debian:trixie-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends make clang \
  && if [ "$(dpkg --print-architecture)" = amd64 ]; then \
    apt-get install -y --no-install-recommends gcc-multilib; fi \
  && rm -rf /var/lib/apt/lists/*
# The tests run as a user, not as root, whom the system lets through the permissions that some of
# them check. The volumes that run.sh makes at build/ and bin/ take the owner of these.
RUN useradd --create-home lerta && mkdir -p /lerta/build /lerta/bin && chown lerta /lerta/build /lerta/bin
USER lerta
