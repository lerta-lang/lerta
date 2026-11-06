# The Linux image, for x86-64 only, with mingw-w64, lld and Wine, to build Windows programs, 64-bit
# and 32-bit, and run them, and llvm-mingw, a clang for Windows that the compiler for Windows runs
# under Wine. tools/docker/run.sh builds lerta-test-linux first.
FROM lerta-test-linux
USER root
RUN dpkg --add-architecture i386 \
  && apt-get update \
  && apt-get install -y --no-install-recommends curl ca-certificates unzip mingw-w64 lld wine wine64 wine32:i386 \
  && rm -rf /var/lib/apt/lists/*
# Without these, Wine writes its own messages to the programs' stderr.
ENV WINEDEBUG=-all XDG_RUNTIME_DIR=/tmp/xdg
# The checksum is that of the archive when it was first fetched: llvm-mingw publishes none.
ARG LLVM_MINGW_VERSION=20261006
ARG LLVM_MINGW=llvm-mingw-$LLVM_MINGW_VERSION-ucrt-x86_64
ARG LLVM_MINGW_SHA256=317492c456aa27ee607a5919f1d2d38dcdc1112516a24d0bf4b00d078f52d17a
RUN curl -sSfL -o /tmp/llvm-mingw.zip \
    "https://github.com/mstorsjo/llvm-mingw/releases/download/$LLVM_MINGW_VERSION/$LLVM_MINGW.zip" \
  && echo "$LLVM_MINGW_SHA256  /tmp/llvm-mingw.zip" | sha256sum -c - \
  && unzip -q /tmp/llvm-mingw.zip -d /opt \
  && mv "/opt/$LLVM_MINGW" /opt/llvm-mingw \
  && rm /tmp/llvm-mingw.zip
ENV WINEPATH=Z:\\opt\\llvm-mingw\\bin
# The prefix is made for the user that runs the tests.
USER lerta
RUN mkdir -m 700 "$XDG_RUNTIME_DIR" && wineboot --init && wineserver --wait
