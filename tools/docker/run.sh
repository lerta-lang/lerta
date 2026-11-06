#!/bin/sh
# Runs a command, bash by default, in a container of the image, built first, on the Linux one as
# the others are.
#
# The container works on the tree mounted read-only, with build/ and bin/, where the build writes,
# each its own empty volume: the containers and the host would otherwise share their builds.
set -eu
usage='usage: tools/docker/run.sh [--name <container>] <linux|wine> [<command> [<argument>...]]'
root=$(cd "$(dirname "$0")/../.." && pwd)
name_option=''
if [ "${1-}" = --name ] && [ $# -ge 2 ]; then
  name_option="--name=$2"
  shift 2
fi
case ${1-} in
  linux | wine) image=$1 ;;
  *) echo "$usage" >&2; exit 2 ;;
esac
shift
for name in linux "$image"; do
  docker build --quiet --tag "lerta-test-$name" "$root/tools/docker/$name" >/dev/null
done
if [ $# -eq 0 ]; then set -- bash; fi
if [ -t 0 ]; then tty_option=-it; else tty_option=-i; fi
# The mount points must be in the tree, which is read-only in the container.
mkdir -p "$root/build" "$root/bin"
# Some Docker setups disable IPv6 in containers, which leaves them no ::1 for the tests of std:net.
exec docker run --rm $name_option $tty_option --sysctl net.ipv6.conf.all.disable_ipv6=0 \
  --volume "$root:/lerta:ro" --volume /lerta/build \
  --volume /lerta/bin --workdir /lerta "lerta-test-$image" "$@"
