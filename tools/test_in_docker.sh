#!/bin/sh
# Runs the tests on this working tree in a Linux container of Docker's own architecture, without
# emulation: the package's `test` script, then, on x86-64, the run tests again as 32-bit programs.
# A 64-bit ARM host may not run 32-bit ARM programs (Apple's CPUs do not), so it has no 32-bit run.
set -eu
root=$(cd "$(dirname "$0")/.." && pwd)
image=lerta-test
docker build --quiet --tag "$image" "$root/tools/docker" >/dev/null
# The tests need none of stage0's packages. npm runs the script without installing them, which
# pnpm would do into the mounted tree; the host's node_modules, built for the host, is hidden.
exec docker run --rm --volume "$root:/lerta" --volume /lerta/stage0/node_modules \
  --workdir /lerta/stage0 "$image" sh -c '
    npm test --silent; native=$?
    if [ "$(uname -m)" = x86_64 ]; then
      nice node test/run.ts --target i686-linux-gnu; bits32=$?
    else
      echo "no 32-bit run on $(uname -m)"; bits32=0
    fi
    exit $((native || bits32))'
