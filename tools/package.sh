#!/bin/sh
# Builds the compiler for each target given, and packs it alone, as `lerta`, into
# build/release/lerta-<version>-<target>.tar.gz, or .zip with `lerta.exe` for Windows, which the
# releases give (see CONTRIBUTING.md#releases).
set -e
version=$(cat VERSION)
mkdir -p build/release
for target in "$@"; do
  make TARGET="$target"
  dir=build/release/$target
  rm -rf "$dir"
  mkdir "$dir"
  archive=build/release/lerta-$version-$target
  case $target in
    windows-*)
      cp "bin/lerta-$target.exe" "$dir/lerta.exe"
      # Git Bash has no zip, but every Windows has PowerShell.
      powershell -NoProfile -Command \
        "Compress-Archive -Force -Path '$dir/lerta.exe' -DestinationPath '$archive.zip'"
      ;;
    *)
      cp "bin/lerta-$target" "$dir/lerta"
      # Without it, macOS's tar adds the file's extended attributes as a file of their own.
      COPYFILE_DISABLE=1 tar -czf "$archive.tar.gz" -C "$dir" lerta
      ;;
  esac
  rm -rf "$dir"
done
