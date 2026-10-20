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
# std's files at any depth, as the seed finds them (see tools/embed.lerta).
EMBEDDED := $(sort $(shell find std -name '*.lerta') $(wildcard runtime/*.c runtime/*.h) $(LIBUV))
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
# docs/internals.md#bootstrap). It is worked out again on each run, as clang may have changed, but
# replaced only when it differs, so that what depends on it is not made again for nothing.
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

build/minilerta: build/seed.ll $(RUNTIME) build/libuv/built
	$(call link_debug,build/seed.ll,$@)

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

# The Lerta test harnesses, which minilerta builds, as it builds the embedder, so that a change to
# the compiler cannot break the harness that tests it (see docs/roadmap/programs.md#tools).
HARNESS := $(shell find test -name '*.lerta')

build/test_run.ll: build/minilerta build/host_llvm.sed $(HARNESS) $(EMBEDDED)
	$(call minilerta_ir,test/run.lerta,$@)

build/test_run: build/test_run.ll $(RUNTIME) build/libuv/built
	$(call link_debug,$<,$@)

build/test_cli.ll: build/minilerta build/host_llvm.sed $(HARNESS) $(EMBEDDED)
	$(call minilerta_ir,test/cli.lerta,$@)

build/test_cli: build/test_cli.ll $(RUNTIME) build/libuv/built
	$(call link_debug,$<,$@)

build/test_format.ll: build/minilerta build/host_llvm.sed $(HARNESS) $(EMBEDDED)
	$(call minilerta_ir,test/format.lerta,$@)

build/test_format: build/test_format.ll $(RUNTIME) build/libuv/built
	$(call link_debug,$<,$@)

build/test_runtime.ll: build/minilerta build/host_llvm.sed $(HARNESS) compiler/clang_flags.lerta $(EMBEDDED)
	$(call minilerta_ir,test/runtime.lerta,$@)

build/test_runtime: build/test_runtime.ll $(RUNTIME) build/libuv/built
	$(call link_debug,$<,$@)

build/stage1.ll: build/minilerta build/host_llvm.sed $(SOURCES) $(EMBEDDED)
	$(call minilerta_ir,$(MAIN),$@)

build/stage1: build/stage1.ll $(RUNTIME) build/libuv/built
	$(call link_debug,$<,$@)

# The compiler keeps the memory checks, so that the tests, which run it on every source of the tests
# and examples, those for other systems in make test-cross, find its own leaks and uses of dropped
# objects (see docs/internals.md#leak-checking).
bin/lerta: build/stage1
	@mkdir -p bin
	build/stage1 build $(MAIN) -o $@ -O --memory-checks -Werror

ifdef TARGET
$(COMPILER): bin/lerta
	bin/lerta build $(MAIN) -o $@ -O -Werror $(TARGET_FLAGS)
endif

# stage2 is unoptimized, which clang builds far faster, and its runs, which build stage3 and print
# its IR, check for leaks.
$(STAGE2): bin/lerta
	@mkdir -p $(BOOTSTRAP)
	bin/lerta build $(MAIN) -o $@ -Werror $(TARGET_FLAGS)

$(BOOTSTRAP)/stage2.ll: bin/lerta
	@mkdir -p $(BOOTSTRAP)
	bin/lerta dump-llvm $(MAIN) > $@

$(BOOTSTRAP)/stage3$(EXE): $(STAGE2)
	$(RUN_STAGE2) build $(MAIN) -o $@ -Werror $(TARGET_FLAGS)

$(BOOTSTRAP)/stage3.ll: $(STAGE2)
	$(RUN_STAGE2) dump-llvm $(MAIN) > $@

# Built for the host, as the seed is only ever built there.
$(BOOTSTRAP)/minilerta.ll: bin/lerta
	@mkdir -p $(BOOTSTRAP)
	bin/lerta build $(MINILERTA_MAIN) -o $(BOOTSTRAP)/minilerta -Werror
	$(BOOTSTRAP)/minilerta $(MAIN) > $@

test-bootstrap: $(BOOTSTRAP)/stage2.ll $(BOOTSTRAP)/stage3.ll $(BOOTSTRAP)/stage3$(EXE) \
  $(BOOTSTRAP)/minilerta.ll
	@cmp -s $(BOOTSTRAP)/stage2.ll $(BOOTSTRAP)/stage3.ll \
	  || { echo 'bootstrap: stage2 and stage3 have different IR' >&2; exit 1; }
	@cmp -s $(BOOTSTRAP)/stage2.ll $(BOOTSTRAP)/minilerta.ll \
	  || { echo "bootstrap: minilerta's entry and dump-llvm print different IR" >&2; exit 1; }
	@echo "bootstrap: stage2, stage3 and minilerta's entry print the same IR"

# Written only from IR that test-bootstrap has found to be a fixed point.
# The seed is written from the host's bootstrap only, so that a target given by mistake cannot
# change it.
ifdef TARGET
seed:
	@echo 'make seed does not take TARGET' >&2; exit 2
else
# The IR is written into build/seed first, so that a failed dump leaves the seed as it is.
seed: test-bootstrap
	rm -rf build/seed
	mkdir -p build/seed/build
	cp -R compiler build/seed/compiler
	build/embed --seed build/seed/build/embedded.lerta
	bin/lerta dump-llvm build/seed/$(MINILERTA_MAIN) > build/seed/minilerta.ll
	cp build/seed/minilerta.ll seed/minilerta.ll
endif

ifdef TARGET
test test-cross:
	@echo 'make $@ does not take TARGET: run build/test_run --target <triple>' >&2; exit 2
else
# Every suite runs even if one before it fails.
test: bin/lerta build/test_run build/test_cli build/test_format build/test_runtime
	@status=0; \
	nice build/test_run || status=1; \
	nice build/test_cli || status=1; \
	nice build/test_format || status=1; \
	nice build/test_runtime || status=1; \
	nice $(MAKE) --no-print-directory test-bootstrap || status=1; \
	exit $$status

test-cross:
	@tools/test_cross.sh
endif

# check checks that the .lerta files that git lists, those not added yet included, are in the style.
# tests/ is left out, as it holds code that is not in the style on purpose, and so is a file deleted
# but not yet from git (test -e). The files go to one run of lerta fmt, which checks a program once
# for the files it holds; xargs splits a list that is too long into more runs.
check: bin/lerta
	@git ls-files -z --cached --others --exclude-standard -- '*.lerta' ':!tests/' \
	  | xargs -0 sh -c 'for f; do test -e "$$f" && printf "%s\0" "$$f"; done' sh \
	  | nice xargs -0 bin/lerta fmt

clean:
	rm -rf build bin

.PHONY: all check seed test test-bootstrap test-cross clean
