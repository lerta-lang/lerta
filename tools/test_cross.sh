#!/bin/sh
# Runs the tests for every environment but the host's own, which `make test` covers, by the
# shortest way without emulation: each other target on the host if it can build and run its
# programs, Linux in a container of the host's architecture if the host is not Linux, and what
# is left in a container that runs it, which only an x86-64 host runs as it is. Prints what ran
# and what was skipped, and why.
#
# With --here and triples, the tests of those targets run on this machine only, as the
# containers do.
set -u
root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root"
# Without it, Wine writes its own messages to the programs' stderr.
export WINEDEBUG=-all

is_windows() {
  case $1 in *-w64-mingw32) ;; *) return 1 ;; esac
}

test_target() {
  nice node test/run.ts --target "$1" || return 1
  if is_windows "$1" && ! has_windows_clang; then
    skip "the bootstrap for $1" "needs a clang for Windows on Wine's PATH"
    return
  fi
  nice make --no-print-directory check-bootstrap TARGET="$1"
}

# The compiler for Windows builds the next stage of the bootstrap with it.
has_windows_clang() {
  wine clang --version >/dev/null 2>&1
}

# Whether clang builds a C program for the target that this machine then runs. The compiler is
# kept out of it, so that a bug of its own fails the tests instead of skipping them.
runs_here() {
  probe=$(mktemp -d)
  printf 'int main(void) { return 0; }\n' >"$probe/probe.c"
  if is_windows "$1"; then
    clang --target="$1" -fuse-ld=lld "$probe/probe.c" -o "$probe/probe.exe" \
      && wine "$probe/probe.exe"
  else
    clang --target="$1" "$probe/probe.c" -o "$probe/probe" && "$probe/probe"
  fi >/dev/null 2>&1
  status=$?
  rm -rf "$probe"
  return $status
}

in_docker() {
  image=lerta-test-$1
  # The other images are built on the Linux one.
  for name in linux "$1"; do
    docker build --quiet --tag "lerta-test-$name" "tools/docker/$name" >/dev/null || return 1
  done
  shift
  # The container builds its own compiler for Linux, so the host's bin/ and build/, built for the
  # host, are hidden, as is its node_modules, which the tests do not need.
  docker run --rm --volume "$root:/lerta" --volume /lerta/bin --volume /lerta/build \
    --volume /lerta/test/node_modules --workdir /lerta "$image" sh -c "$*"
}

summary=''
failed=0
report() { # <what> <command...>
  what=$1
  shift
  if "$@"; then summary="$summary  passed:  $what\n"
  else summary="$summary  FAILED:  $what\n"; failed=1; fi
}
skip() { # <what> <why>
  summary="$summary  skipped: $1 ($2)\n"
}

make --no-print-directory bin/lerta || exit 1

if [ "${1-}" = --here ]; then
  shift
  # The caller reports the result, so a summary here would only repeat it.
  for triple; do test_target "$triple" || failed=1; done
  exit $failed
fi

linux_left=''
windows_left=''
for triple in i686-linux-gnu x86_64-w64-mingw32 i686-w64-mingw32; do
  if runs_here "$triple"; then
    report "$triple on the host" test_target "$triple"
  elif is_windows "$triple"; then
    windows_left="$windows_left $triple"
  else
    linux_left="$linux_left $triple"
  fi
done

if docker info >/dev/null 2>&1; then has_docker=true; else has_docker=false; fi
host_os=$(uname -s)
# Docker runs the containers of the host's architecture without emulation, and the x86-64 ones
# run the 32-bit and the Windows programs.
# Some hosts, macOS among them, name the architectures differently from the triples.
host_linux=$(uname -m | sed 's/^arm64$/aarch64/; s/^amd64$/x86_64/')-linux-gnu
case $host_linux in x86_64-*) x86_64=true ;; *) x86_64=false ;; esac

if [ "$host_os" != Linux ]; then
  if ! $has_docker; then skip "$host_linux" 'no Docker'
  elif $x86_64; then
    report "$host_linux in Docker${linux_left:+, with$linux_left}" in_docker linux \
      "make --no-print-directory test; native=\$?; tools/test_cross.sh --here$linux_left; exit \$((native || \$?))"
    linux_left=''
  else
    report "$host_linux in Docker" in_docker linux 'make --no-print-directory test'
  fi
fi
for triple in $linux_left; do
  if ! $x86_64; then skip "$triple" 'needs an x86-64 host'
  elif ! $has_docker; then skip "$triple" 'needs the 32-bit C library, or Docker'
  else report "$triple in Docker" in_docker linux "tools/test_cross.sh --here $triple"
  fi
done
if [ -n "$windows_left" ]; then
  if $x86_64 && $has_docker; then
    report "${windows_left# } in Docker with Wine" in_docker wine \
      "tools/test_cross.sh --here$windows_left"
  else
    skip "${windows_left# }" 'needs mingw-w64, lld and Wine, or Docker on an x86-64 host'
  fi
fi

printf '\ntest_cross.sh:\n%b' "$summary"
exit $failed
