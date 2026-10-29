#!/bin/sh
# Runs the tests for every environment but the host's own (see README.md#building-and-testing).
#
# The targets run one after another, each container's and the host's own. The summary at the end
# leaves out what a container skips, which only its output tells.
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

record_failure() { # <what>
  summary="$summary  FAILED:  $1\n"
  failed=1
}

comma_list() { # <word>...
  echo "$*" | sed 's/ /, /g'
}

test_target() {
  nice bin/test --target "$1" || return 1
  if is_windows "$1" && ! has_windows_clang; then
    skip "the bootstrap for $1" "needs a clang for Windows on Wine's PATH"
    return
  fi
  nice make --no-print-directory test-bootstrap TARGET="$1"
}

# Runs the targets that this machine runs, reported as each with the label added.
run_targets() { # <label> <triple>...
  label=$1
  shift
  for triple; do run "$triple$label" test_target "$triple"; done
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

# Runs a command in a container of the image (see tools/docker/run.sh).
run_in_docker() { # <what> <image> <command>
  container_count=$((container_count + 1))
  container="lerta-test-$$-$container_count"
  run "$1" in_docker "$container" "$2" "$3"
  container=''
}
# Named, so that an interruption can stop it (see stop), which stopping docker run does not.
container=''
container_count=0

in_docker() { # <container> <image> <command>
  tools/docker/run.sh --name "$1" "$2" sh -c "$3" &
  # Run in the background and waited for, as a trap runs only once a foreground command ends, and
  # the container's shell, its PID 1, ignores the interruption that docker run would pass on.
  in_docker_pid=$!
  wait $in_docker_pid
  status=$?
  in_docker_pid=''
  return $status
}
in_docker_pid=''

summary=''
failed=0
# Printed too, as the summary of --here is not.
skip() { # <what> <why>
  echo "skipped: $1 ($2)"
  summary="$summary  skipped: $1 ($2)\n"
}

run() { # <what> <command...>
  what=$1
  shift
  echo "started: $what"
  if "$@"; then summary="$summary  passed:  $what\n"
  else record_failure "$what"; fi
}

stop() {
  # The background run.sh ignores the interruption, and would otherwise go on to start the
  # container after this exits. A docker build that it runs still finishes on its own.
  if [ -n "$in_docker_pid" ]; then kill "$in_docker_pid" 2>/dev/null; fi
  # Removed, not killed, as one that docker run created but did not start is left otherwise.
  if [ -n "$container" ]; then docker rm --force "$container" >/dev/null 2>&1; fi
  exit 130
}
trap stop HUP INT TERM

make --no-print-directory bin/lerta bin/test || exit 1

if [ "${1-}" = --here ]; then
  shift
  # The caller reports the result, so a summary here would only repeat it.
  run_targets '' "$@"
  exit $failed
fi

host_left=''
linux_left=''
windows_left=''
for triple in i686-linux-gnu x86_64-w64-mingw32 i686-w64-mingw32; do
  if runs_here "$triple"; then
    host_left="$host_left $triple"
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
    run_in_docker "$(comma_list $host_linux $linux_left) in Docker" linux \
      "make --no-print-directory test; native=\$?; tools/test_cross.sh --here$linux_left; exit \$((native || \$?))"
    linux_left=''
  else
    run_in_docker "$host_linux in Docker" linux 'make --no-print-directory test'
  fi
fi
for triple in $linux_left; do
  if ! $x86_64; then skip "$triple" 'needs an x86-64 host'
  elif ! $has_docker; then skip "$triple" 'needs the 32-bit C library, or Docker'
  else run_in_docker "$triple in Docker" linux "tools/test_cross.sh --here $triple"
  fi
done
if [ -n "$windows_left" ]; then
  if $x86_64 && $has_docker; then
    run_in_docker "$(comma_list $windows_left) in Docker with Wine" wine \
      "tools/test_cross.sh --here$windows_left"
  else
    skip "$(comma_list $windows_left)" 'needs mingw-w64, lld and Wine, or Docker on an x86-64 host'
  fi
fi
run_targets ' on the host' $host_left
printf '\ntest_cross.sh:\n%b' "$summary"
exit $failed
