#!/bin/sh
# Builds each benchmark of bench/ in Lerta, C, Swift and JavaScript (Node.js), checks that all
# print the same, and prints the best of 3 wall-clock times of each in seconds. Run it from the
# repository's root after `make`, with clang, swiftc and node on the PATH; the programs go to
# build/bench/. Nothing else runs them: they are not tests.
set -eu

out=build/bench
mkdir -p "$out"

# Fails, through set -e, when the program does.
time_once() {
  /usr/bin/time -p "$@" 2>"$out/time" >/dev/null
  awk '/^real/ { print $2 }' "$out/time"
}

best_time() {
  times=$(time_once "$@"; time_once "$@"; time_once "$@")
  echo "$times" | sort -n | head -n 1
}

printf '%-12s %8s %8s %8s %8s\n' benchmark lerta c swift node
for dir in bench/*/; do
  name=$(basename "$dir")
  bin/lerta build "$dir/main.lerta" -O -o "$out/$name-lerta"
  clang -O2 "$dir/main.c" -o "$out/$name-c"
  swiftc -O "$dir/main.swift" -o "$out/$name-swift"
  set -- "$out/$name-lerta" "$out/$name-c" "$out/$name-swift" "node $dir/main.js"

  expected=$($1)
  for command in "$@"; do
    actual=$($command)
    if [ "$actual" != "$expected" ]; then
      echo "$name: $command printed $actual, $1 printed $expected" >&2
      exit 1
    fi
  done

  printf '%-12s' "$name"
  for command in "$@"; do
    # shellcheck disable=SC2086 # The command and its arguments are split on purpose.
    time=$(best_time $command)
    printf ' %8s' "$time"
  done
  printf '\n'
done
