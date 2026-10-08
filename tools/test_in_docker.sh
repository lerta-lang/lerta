#!/bin/sh
# Runs the tests on this working tree in a Linux container of Docker's own architecture, without
# emulation: `make test`, then, on x86-64, the run tests again as 32-bit programs, the bootstrap
# through a 32-bit compiler, and the run tests as 64-bit and 32-bit Windows programs under Wine.
# Those runs need x86-64, where the image installs the 32-bit C library, mingw-w64 and Wine; a
# 64-bit ARM host may not run 32-bit ARM programs (Apple's CPUs do not).
set -eu
root=$(cd "$(dirname "$0")/.." && pwd)
image=lerta-test
docker build --quiet --tag "$image" "$root/tools/docker" >/dev/null
# The container builds its own compiler for Linux, so the host's bin/ and build/, built for the
# host, are hidden, as is its node_modules, which the tests do not need.
exec docker run --rm --volume "$root:/lerta" --volume /lerta/bin --volume /lerta/build \
  --volume /lerta/test/node_modules --workdir /lerta "$image" sh -c '
    make --no-print-directory test; native=$?
    if [ "$(uname -m)" = x86_64 ]; then
      nice node test/run.ts --target i686-linux-gnu; run32=$?
      nice make --no-print-directory check-bootstrap TARGET=i686-linux-gnu; bootstrap32=$?
      nice node test/run.ts --target x86_64-w64-mingw32; windows64=$?
      nice node test/run.ts --target i686-w64-mingw32; windows32=$?
      others=$((run32 || bootstrap32 || windows64 || windows32))
    else
      echo "no 32-bit or Windows run on $(uname -m)"; others=0
    fi
    exit $((native || others))'
