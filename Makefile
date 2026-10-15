# Builds the compiler from the seed, the compiler's own LLVM IR, and checks and tests it. See
# README.md for the targets and docs/internals.md#bootstrap for the bootstrap. Written for GNU make
# 3.81, the one macOS has.

# The files that the compiler carries in build/embedded.lerta, which tools/embed.lerta writes.
# What third_party/libuv.txt lists of the kind $(1) for the host's system, on which the compiler
# runs: macOS or Linux, by the rule of is_for in compiler/libuv.lerta.
HOST_SYSTEM := $(if $(filter Darwin,$(shell uname -s)),macos,linux)
HOST_LIBUV_SYSTEMS := all posix $(HOST_SYSTEM)
host_libuv = $(shell awk -v kind=$(1) -v systems='$(HOST_LIBUV_SYSTEMS)' \
  'BEGIN { split(systems, list, " "); for (i in list) wanted[list[i]] = 1 } \
  $$2 == kind && ($$1 in wanted) { print $$3 }' third_party/libuv.txt)

# Of libuv, the headers, and the sources that third_party/libuv.txt lists for some system.
LIBUV_HEADERS := $(shell find third_party/libuv/include third_party/libuv/src -name '*.h')
LIBUV_SOURCES := $(shell awk '$$2 == "source" { print "third_party/libuv/" $$3 }' third_party/libuv.txt)
LIBUV := third_party/libuv.txt $(LIBUV_HEADERS) $(LIBUV_SOURCES)
EMBEDDED := $(sort $(wildcard std/*.lerta runtime/*.c runtime/*.h) $(LIBUV))
SOURCES := $(shell find compiler -name '*.lerta') build/embedded.lerta
RUNTIME_C := $(wildcard runtime/*.c)
RUNTIME := $(RUNTIME_C) $(wildcard runtime/*.h)
MAIN := compiler/main.lerta
MINILERTA_MAIN := compiler/minilerta.lerta
ifdef TARGET
TARGET_FLAGS := --target $(TARGET)
EXE := $(if $(filter %-w64-mingw32,$(TARGET)),.exe)
COMPILER := bin/lerta-$(TARGET)$(EXE)
else
COMPILER := bin/lerta
endif
BOOTSTRAP := build/bootstrap$(if $(TARGET),-$(TARGET))
# stage2 runs for its target: under Wine for Windows.
STAGE2 := $(BOOTSTRAP)/stage2$(EXE)
RUN_STAGE2 := $(if $(EXE),wine )$(STAGE2)

all: $(COMPILER)

# So that a failed rule, such as `dump-llvm > $@`, leaves no partial target that the next run would
# take as up to date.
.DELETE_ON_ERROR:

# Rewrites llvm.coro.end for the host's LLVM, and is empty when there is nothing to rewrite (see
# docs/internals.md#bootstrap).
CORO_END_PROBE = extern "C" void f(void *handle) { __builtin_coro_end(handle, 0); }
build/host_llvm.sed:
	@mkdir -p build
	if echo '$(CORO_END_PROBE)' | clang -x c++ -std=c++20 -S -emit-llvm - -o - | grep -q '^declare void @llvm.coro.end('; then \
	  printf '%s\n' 's/^declare i1 @llvm\.coro\.end(/declare void @llvm.coro.end(/' \
	    's/%[^ ]* = call i1 @llvm\.coro\.end(/call void @llvm.coro.end(/' > $@; \
	else : > $@; fi

build/seed.ll: seed/lerta.ll build/host_llvm.sed
	sed -f build/host_llvm.sed seed/lerta.ll > $@

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
  $(RUNTIME_C) build/libuv/*.o $(addprefix -l,$(call host_libuv,library)) -o $(2)

build/minilerta: build/seed.ll $(RUNTIME) build/libuv/built
	$(call link_debug,build/seed.ll,$@)

# The host's libuv, as the compiler builds it with a program's runtime (see compiler/libuv.lerta):
# with its flags and its warnings silenced, apart from the runtime, which needs only its headers.
build/libuv/built: $(LIBUV)
	@rm -rf build/libuv && mkdir -p build/libuv
	cd build/libuv && clang -c $(call host_libuv,flag) -I$(CURDIR)/third_party/libuv/include \
	  -I$(CURDIR)/third_party/libuv/src -w \
	  $(addprefix $(CURDIR)/third_party/libuv/,$(call host_libuv,source))
	touch $@

# Each rule that runs minilerta depends on std/ and runtime/ too, which it reads (see
# docs/internals.md#bootstrap).
build/embed.ll: build/minilerta build/host_llvm.sed tools/embed.lerta $(EMBEDDED)
	$(call minilerta_ir,tools/embed.lerta,$@)

build/embed: build/embed.ll $(RUNTIME) build/libuv/built
	$(call link_debug,$<,$@)

build/embedded.lerta: build/embed $(EMBEDDED)
	build/embed $@ $(EMBEDDED)

build/stage1.ll: build/minilerta build/host_llvm.sed $(SOURCES) $(EMBEDDED)
	$(call minilerta_ir,$(MAIN),$@)

build/stage1: build/stage1.ll $(RUNTIME) build/libuv/built
	$(call link_debug,$<,$@)

# stage1 holds std/ and runtime/, which it embeds, as bin/lerta does. The compiler builds itself
# without warnings.
bin/lerta: build/stage1
	@mkdir -p bin
	build/stage1 build $(MAIN) -o $@ -O -Werror

ifdef TARGET
$(COMPILER): bin/lerta
	bin/lerta build $(MAIN) -o $@ -O -Werror $(TARGET_FLAGS)
endif

# stage2 is unoptimized, so that its runs, which build stage3 and print its IR, check for leaks.
$(STAGE2): bin/lerta
	@mkdir -p $(BOOTSTRAP)
	bin/lerta build $(MAIN) -o $@ -Werror $(TARGET_FLAGS)

$(BOOTSTRAP)/stage2.ll: bin/lerta
	@mkdir -p $(BOOTSTRAP)
	bin/lerta dump-llvm $(MAIN) > $@

# The debug runtime reports a leak to stderr without failing, so a run of stage2 fails on the report.
# $(1) is the command line, $(2) the file that keeps its stderr meanwhile.
define run_stage2_without_leaks
$(RUN_STAGE2) $(1) 2> $(2); status=$$?; cat $(2) >&2; \
  if grep -q '^leak: ' $(2); then status=1; fi; rm -f $(2); exit $$status
endef

$(BOOTSTRAP)/stage3$(EXE): $(STAGE2)
	$(call run_stage2_without_leaks,build $(MAIN) -o $@ -Werror $(TARGET_FLAGS),$@.stderr)

$(BOOTSTRAP)/stage3.ll: $(STAGE2)
	$(call run_stage2_without_leaks,dump-llvm $(MAIN) > $@,$@.stderr)

# minilerta's entry, which nothing else builds before make seed, must print the IR that dump-llvm
# does. It is built for the host, as the seed is only ever built there.
$(BOOTSTRAP)/minilerta.ll: bin/lerta
	@mkdir -p $(BOOTSTRAP)
	bin/lerta build $(MINILERTA_MAIN) -o $(BOOTSTRAP)/minilerta -Werror
	$(BOOTSTRAP)/minilerta $(MAIN) > $@

# Only the IR is compared (see docs/internals.md#bootstrap): that of stage2, which bin/lerta
# prints, and that of stage3, which stage2 prints. For Windows, stage2 builds stage3 with a clang for
# Windows, which it finds on Wine's PATH.
check-bootstrap: $(BOOTSTRAP)/stage2.ll $(BOOTSTRAP)/stage3.ll $(BOOTSTRAP)/stage3$(EXE) \
  $(BOOTSTRAP)/minilerta.ll
	@cmp -s $(BOOTSTRAP)/stage2.ll $(BOOTSTRAP)/stage3.ll \
	  || { echo 'bootstrap: stage2 and stage3 have different IR' >&2; exit 1; }
	@cmp -s $(BOOTSTRAP)/stage2.ll $(BOOTSTRAP)/minilerta.ll \
	  || { echo "bootstrap: minilerta's entry and dump-llvm print different IR" >&2; exit 1; }
	@echo "bootstrap: stage2, stage3 and minilerta's entry print the same IR"

# Written only from IR that check-bootstrap has found to be a fixed point.
# The seed is written from the host's bootstrap only, so that a target given by mistake cannot
# change it.
ifdef TARGET
seed:
	@echo 'make seed does not take TARGET' >&2; exit 2
else
# The seed's compiler embeds std/ and runtime/ in seed mode, in a copy of compiler/ beside its own
# build/, so that the build's own build/embedded.lerta stays as it is.
seed: check-bootstrap
	rm -rf build/seed
	mkdir -p build/seed/build
	cp -R compiler build/seed/compiler
	build/embed --seed build/seed/build/embedded.lerta $(EMBEDDED)
	bin/lerta dump-llvm build/seed/$(MINILERTA_MAIN) > build/seed/lerta.ll
	cp build/seed/lerta.ll seed/lerta.ll
endif

# test runs the tests on the host only, and test-cross for every other environment it can reach.
ifdef TARGET
test test-cross:
	@echo 'make $@ does not take TARGET: run node test/run.ts --target <triple>' >&2; exit 2
else
# Every suite runs even if one before it fails.
test: bin/lerta
	@status=0; \
	nice node test/run.ts || status=1; \
	nice node test/cli.ts || status=1; \
	nice node test/runtime.ts || status=1; \
	nice node test/format.ts || status=1; \
	nice $(MAKE) --no-print-directory check-bootstrap || status=1; \
	exit $$status

test-cross:
	@tools/test_cross.sh
endif

# check checks that the .lerta files that git lists, those not added yet included, are in the style,
# and runs pnpm check in test/. tests/ is left out, as it holds code that is not in the style on
# purpose, and so is a file deleted but not yet from git (test -e). The files go to one run of
# lerta fmt, which checks a program once for the files it holds, while pnpm check runs; xargs splits
# a list that is too long into more runs.
check: bin/lerta
	@status=0; \
	git ls-files -z --cached --others --exclude-standard -- '*.lerta' ':!tests/' \
	  | xargs -0 sh -c 'for f; do test -e "$$f" && printf "%s\0" "$$f"; done' sh \
	  | nice xargs -0 bin/lerta fmt & fmt=$$!; \
	(cd test && nice pnpm check) || status=1; \
	wait $$fmt || status=1; \
	exit $$status

clean:
	rm -rf build bin

# A command that fails leaves no file, such as half of an IR printed to a redirection.
.DELETE_ON_ERROR:

.PHONY: all check check-bootstrap seed test test-cross clean
