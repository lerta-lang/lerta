#!/bin/sh
# Runs the tests for every environment but the host's own, which `make test` covers, by the
# shortest way without emulation: each other target on the host if it can build and run its
# programs, Linux in a container of the host's architecture if the host is not Linux, and what
# is left in a container that runs it, which only an x86-64 host runs as it is. Prints what ran
# and what was skipped, and why.
#
# The targets run at the same time, each container's and the host's own, with their outputs kept
# apart (see start).
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

# Wine updates a prefix that another version of it made, in place, as it starts, which test/wine.ts
# does before a run copies it. Targets that run at the same time would update it while another
# copies it, so it is updated once, before they start, and test/wine.ts is told so.
update_wine_prefix() {
  wine cmd /c exit && wineserver --wait \
    && export LERTA_WINE_PREFIX_UPDATED="${WINEPREFIX:-$HOME/.wine}"
}

# Starts the targets that this machine runs, as jobs reported as each with the label added.
start_targets() { # <label> <triple>...
  label=$1
  shift
  wine_ready=unknown
  for triple; do
    if is_windows "$triple"; then
      if [ "$wine_ready" = unknown ]; then
        if update_wine_prefix; then wine_ready=true; else wine_ready=false; fi
      fi
      if ! $wine_ready; then
        # Printed too, as the summary of --here is not.
        echo "cannot update the Wine prefix for $triple" >&2
        summary="$summary  FAILED:  $triple$label (cannot update the Wine prefix)\n"
        failed=1
        continue
      fi
    fi
    start "$triple$label" test_target "$triple"
  done
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

# Starts a job in a container of the image, built first, on the Linux one as the others are; built
# before the job starts, as jobs that built it at the same time would each build it.
start_in_docker() { # <what> <image> <command>
  for name in linux "$2"; do
    if ! docker build --quiet --tag "lerta-test-$name" "tools/docker/$name" >/dev/null; then
      summary="$summary  FAILED:  $1 (cannot build the image)\n"
      failed=1
      return
    fi
  done
  container_count=$((container_count + 1))
  container="lerta-test-$$-$container_count"
  containers="$containers $container"
  start "$1" in_docker "$container" "$2" "$3"
}
# Named, so that an interruption can stop them (see stop_jobs), which stopping docker run does not.
containers=''
container_count=0

# The container works in a copy of the tree, which is mounted read-only: the containers that run at
# the same time would otherwise each write their own build of compiler/embedded.lerta into it. The
# copy leaves out bin/, build/, test/node_modules and compiler/embedded.lerta, which the host built
# for itself.
in_docker() { # <container> <image> <command>
  container=$1
  image=lerta-test-$2
  shift 2
  copy="mkdir /work && tar -C /lerta --exclude=./.git --exclude=./bin --exclude=./build \
    --exclude=./test/node_modules --exclude=./compiler/embedded.lerta -cf - . \
    | tar -C /work -xf - && cd /work"
  docker run --rm --name "$container" --volume "$root:/lerta:ro" "$image" \
    sh -c "$copy && $*"
}

summary=''
failed=0
# A job, whose own summary is lost, prints it instead, for finish to add.
SKIP_MARK='test_cross.sh skipped: '
skip() { # <what> <why>
  if ${in_job:-false}; then echo "$SKIP_MARK$1 ($2)"; fi
  summary="$summary  skipped: $1 ($2)\n"
}

# The jobs that run at the same time, each with its output kept in a file, so that their outputs
# do not mix: one line each, of its process, its file and what it tests.
jobs=''
start() { # <what> <command...>
  what=$1
  shift
  log=$(mktemp)
  echo "started: $what"
  (in_job=true; "$@") >"$log" 2>&1 &
  jobs="$jobs$! $log $what
"
}
# Waits for the jobs, then prints their outputs and reports them, in the order they started.
finish() {
  while read -r pid log what; do
    [ -n "$pid" ] || continue
    if wait "$pid"; then summary="$summary  passed:  $what\n"
    else summary="$summary  FAILED:  $what\n"; failed=1; fi
    # --here keeps them for its caller, which reports them.
    if $here; then cat "$log"; else sed "/^$SKIP_MARK/d" "$log"; fi
    skipped=$(sed -n "s/^$SKIP_MARK/  skipped: /p" "$log")
    if [ -n "$skipped" ]; then summary="$summary$skipped\n"; fi
    rm -f "$log"
  done <<EOF_JOBS
$jobs
EOF_JOBS
  jobs=''
}

# An interruption stops the jobs and their containers too, which would otherwise go on: the jobs,
# which ignore SIGINT as background commands do, by a SIGTERM to the process group, which this
# script then ignores.
stop_jobs() {
  for container in $containers; do docker kill "$container" >/dev/null 2>&1; done
  trap '' TERM
  kill -TERM 0
  while read -r pid log what; do
    [ -n "$pid" ] && rm -f "$log"
  done <<EOF_JOBS
$jobs
EOF_JOBS
  exit 130
}
trap stop_jobs HUP INT TERM

make --no-print-directory bin/lerta || exit 1

here=false
if [ "${1-}" = --here ]; then
  here=true
  shift
  # The caller reports the result, so a summary here would only repeat it.
  start_targets '' "$@"
  finish
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
    start_in_docker "$host_linux in Docker${linux_left:+, with$linux_left}" linux \
      "make --no-print-directory test; native=\$?; tools/test_cross.sh --here$linux_left; exit \$((native || \$?))"
    linux_left=''
  else
    start_in_docker "$host_linux in Docker" linux 'make --no-print-directory test'
  fi
fi
for triple in $linux_left; do
  if ! $x86_64; then skip "$triple" 'needs an x86-64 host'
  elif ! $has_docker; then skip "$triple" 'needs the 32-bit C library, or Docker'
  else start_in_docker "$triple in Docker" linux "tools/test_cross.sh --here $triple"
  fi
done
if [ -n "$windows_left" ]; then
  if $x86_64 && $has_docker; then
    start_in_docker "${windows_left# } in Docker with Wine" wine \
      "tools/test_cross.sh --here$windows_left"
  else
    skip "${windows_left# }" 'needs mingw-w64, lld and Wine, or Docker on an x86-64 host'
  fi
fi
start_targets ' on the host' $host_left
finish
printf '\ntest_cross.sh:\n%b' "$summary"
exit $failed
