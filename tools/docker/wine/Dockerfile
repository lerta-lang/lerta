# The Linux image, for x86-64 only, with mingw-w64, lld and Wine, to build Windows programs, 64-bit
# and 32-bit, and run them. tools/test_cross.sh builds lerta-test-linux first.
FROM lerta-test-linux
RUN dpkg --add-architecture i386 \
  && apt-get update \
  && apt-get install -y --no-install-recommends mingw-w64 lld wine wine64 wine32:i386 \
  && rm -rf /var/lib/apt/lists/*
# Without these, Wine writes its own messages to the programs' stderr.
ENV WINEDEBUG=-all XDG_RUNTIME_DIR=/tmp/xdg
RUN mkdir -m 700 "$XDG_RUNTIME_DIR" && wineboot --init && wineserver --wait
