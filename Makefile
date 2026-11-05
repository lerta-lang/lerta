# Builds minilerta from the seed, the compiler's own LLVM IR, and with it tools/build.lerta, which
# builds the compiler, and checks and tests it. See README.md for the goals and
# docs/internals/architecture.md#bootstrap for the bootstrap. Written for GNU make 3.81, the one
# macOS has.

# The host's system, on which the compiler runs: macOS, Linux, or Windows, where make runs in the
# shell of Git for Windows, whose uname names MINGW64_NT-<version>, or in MSYS2's, MSYS_NT-<version>.
UNAME := $(shell uname -s)
HOST_SYSTEM := $(if $(filter Darwin,$(UNAME)),macos,$(if $(filter MINGW% MSYS%,$(UNAME)),windows,linux))
HOST_WINDOWS := $(filter windows,$(HOST_SYSTEM))
# What a program built for the host ends with; that shell runs it without.
HOST_EXE := $(if $(HOST_WINDOWS),.exe)
# What third_party/libuv.txt lists of the kind $(1) for the host's system, by the rule of is_for in
# compiler/libuv_description.lerta.
HOST_LIBUV_SYSTEMS := all $(if $(HOST_WINDOWS),,posix) $(HOST_SYSTEM)
host_libuv = $(shell awk -v kind=$(1) -v systems='$(HOST_LIBUV_SYSTEMS)' \
  'BEGIN { split(systems, list, " "); for (i in list) wanted[list[i]] = 1 } \
  $$2 == kind && ($$1 in wanted) { print $$3 }' third_party/libuv.txt)

# Of libuv, the headers, and the sources that third_party/libuv.txt lists for some system.
LIBUV_HEADERS := $(shell find third_party/libuv/include third_party/libuv/src -name '*.h')
LIBUV_SOURCES := $(shell awk '$$2 == "source" { print "third_party/libuv/" $$3 }' third_party/libuv.txt)
LIBUV := third_party/libuv.txt $(LIBUV_HEADERS) $(LIBUV_SOURCES)
# The host's: platform_<systems>.c only for the host's systems, as compiler/runtime_cache.lerta
# takes them.
RUNTIME_C := $(filter-out runtime/platform_%.c,$(wildcard runtime/*.c)) \
  $(foreach systems,$(HOST_LIBUV_SYSTEMS),$(wildcard runtime/platform_$(systems).c))
RUNTIME := $(wildcard runtime/*.c runtime/*.h)
# What tools/build.lerta is built from: itself, the compiler's modules, some of which it imports,
# and std, which minilerta reads.
BUILD_TOOL_SOURCES := tools/build.lerta $(shell find tools/build compiler std -name '*.lerta')

# The goals, which tools/build.lerta builds once the Makefile has built it from the seed: see
# README.md. Each runs it, as it finds what to make again itself.
GOALS := all bin/lerta bin/test test test-bootstrap seed check bench bench-http site site-serve \
  test-cross

$(GOALS): build/build$(HOST_EXE)
	@build/build $@ $(if $(TARGET),--target $(TARGET))

# Goals run one at a time, even under -j, as each run of build/build makes what it needs in build/
# and bin/, which another run would make at the same time.
.NOTPARALLEL:

# So that a failed rule, such as `minilerta ... > $@`, leaves no partial target that the next run
# would take as up to date.
.DELETE_ON_ERROR:

# Rewrites llvm.coro.end for the host's LLVM, and is empty when there is nothing to rewrite (see
# docs/internals/architecture.md#bootstrap). It is worked out again on each run, as clang may have
# changed, but replaced only when it differs, so that what depends on it is not made again for
# nothing.
CORO_END_PROBE = extern "C" void f(void *handle) { __builtin_coro_end(handle, 0); }
# The new one is written under a name of its own, as builds for several targets may run it at once.
build/host_llvm.sed: FORCE
	@mkdir -p build
	@new=$@.$$$$; \
	if echo '$(CORO_END_PROBE)' | clang -x c++ -std=c++20 -S -emit-llvm - -o - | grep -q '^declare void @llvm.coro.end('; then \
	  printf '%s\n' 's/^declare i1 @llvm\.coro\.end(/declare void @llvm.coro.end(/' \
	    's/%[^ ]* = call i1 @llvm\.coro\.end(/call void @llvm.coro.end(/' > $$new; \
	else : > $$new; fi; \
	if cmp -s $$new $@; then rm $$new; else mv $$new $@; fi

FORCE:

build/seed.ll: seed/minilerta.ll build/host_llvm.sed
	sed -f build/host_llvm.sed seed/minilerta.ll > $@

# What minilerta prints for the source $(1), into the IR file $(2).
define minilerta_ir
build/minilerta $(1) > $(2).unfixed || { rm -f $(2).unfixed; exit 1; }
sed -f build/host_llvm.sed $(2).unfixed > $(2)
rm $(2).unfixed
endef

# Links the IR $(1) into $(2) with the debug runtime, as the compiler's own unoptimized build does:
# clang compiles the IR far faster without optimization than the program loses running unoptimized,
# and each such program runs little.
link_debug = clang -Wno-override-module $(1) -D LERTA_DEBUG -Ithird_party/libuv/include \
  $(RUNTIME_C) build/libuv/*.o $(addprefix -l,m $(call host_libuv,library)) -o $(2)

build/minilerta$(HOST_EXE): build/seed.ll $(RUNTIME) build/libuv/built
	$(call link_debug,build/seed.ll,$@)

build/libuv/built: $(LIBUV)
	@rm -rf build/libuv && mkdir -p build/libuv
	cd build/libuv && clang -c $(call host_libuv,flag) -I$(CURDIR)/third_party/libuv/include \
	  -I$(CURDIR)/third_party/libuv/src -w \
	  $(addprefix $(CURDIR)/third_party/libuv/,$(call host_libuv,source))
	touch $@

build/build.ll: build/minilerta$(HOST_EXE) build/host_llvm.sed $(BUILD_TOOL_SOURCES)
	$(call minilerta_ir,tools/build.lerta,$@)

build/build$(HOST_EXE): build/build.ll $(RUNTIME) build/libuv/built
	$(call link_debug,$<,$@)

clean:
	rm -rf build bin

.PHONY: $(GOALS) clean
