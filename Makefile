# Builds the compiler from the seed, the compiler's own LLVM IR, and checks and tests it. See
# README.md for the targets and docs/internals.md#bootstrap for the bootstrap. Written for GNU make
# 3.81, the one macOS has.

# The files that the compiler carries in compiler/embedded.lerta, which tools/embed.lerta writes.
EMBEDDED := $(sort $(wildcard std/*.lerta runtime/*.c runtime/*.h))
SOURCES := $(shell find compiler -name '*.lerta') compiler/embedded.lerta
RUNTIME_C := $(wildcard runtime/*.c)
RUNTIME := $(RUNTIME_C) $(wildcard runtime/*.h)
MAIN := compiler/main.lerta
ifdef TARGET
TARGET_FLAGS := --target $(TARGET)
EXE := $(if $(filter %-w64-mingw32,$(TARGET)),.exe)
COMPILER := bin/lerta-$(TARGET)$(EXE)
else
COMPILER := bin/lerta
endif
BOOTSTRAP := build/bootstrap$(if $(TARGET),-$(TARGET))

all: $(COMPILER)

build/seed.ll: seed/lerta.ll
	@mkdir -p build
	cp seed/lerta.ll $@

# Linked with the debug runtime, as the compiler's own unoptimized build does: clang compiles the
# IR far faster without optimization than minilerta loses running unoptimized, and it runs little.
build/minilerta: build/seed.ll $(RUNTIME)
	clang -Wno-override-module build/seed.ll -D LERTA_DEBUG $(RUNTIME_C) -o $@

# Each rule that runs minilerta depends on std/ and runtime/ too, which it reads (see
# docs/internals.md#bootstrap).
build/embed: build/minilerta tools/embed.lerta $(EMBEDDED)
	build/minilerta build tools/embed.lerta -o $@

compiler/embedded.lerta: build/embed $(EMBEDDED)
	build/embed $@ $(EMBEDDED)

bin/lerta: build/minilerta $(SOURCES) $(EMBEDDED)
	@mkdir -p bin
	build/minilerta build $(MAIN) -o $@ -O

ifdef TARGET
$(COMPILER): bin/lerta
	bin/lerta build $(MAIN) -o $@ -O $(TARGET_FLAGS)
endif

# stage2 is unoptimized, so that its runs, which build stage3 and print its IR, check for leaks.
$(BOOTSTRAP)/stage2: bin/lerta
	@mkdir -p $(BOOTSTRAP)
	bin/lerta build $(MAIN) -o $@ $(TARGET_FLAGS)

$(BOOTSTRAP)/stage2.ll: bin/lerta
	@mkdir -p $(BOOTSTRAP)
	bin/lerta dump-llvm $(MAIN) > $@

$(BOOTSTRAP)/stage3: $(BOOTSTRAP)/stage2
	$(BOOTSTRAP)/stage2 build $(MAIN) -o $@ $(TARGET_FLAGS)

$(BOOTSTRAP)/stage3.ll: $(BOOTSTRAP)/stage2
	$(BOOTSTRAP)/stage2 dump-llvm $(MAIN) > $@

# Only the IR is compared (see docs/internals.md#bootstrap): that of stage2, which bin/lerta
# prints, and that of stage3, which stage2 prints.
ifneq ($(EXE),)
# Its stages would be Windows programs, which need Wine to run and a clang for Windows to build
# the next stage.
check-bootstrap:
	@echo 'check-bootstrap does not support Windows targets yet' >&2; exit 2
else
check-bootstrap: $(BOOTSTRAP)/stage2.ll $(BOOTSTRAP)/stage3.ll $(BOOTSTRAP)/stage3
	@cmp -s $(BOOTSTRAP)/stage2.ll $(BOOTSTRAP)/stage3.ll \
	  || { echo 'bootstrap: stage2 and stage3 have different IR' >&2; exit 1; }
	@echo 'bootstrap: stage2 and stage3 have the same IR'
endif

# Written only from IR that check-bootstrap has found to be a fixed point.
# The seed is written from the host's bootstrap only, so that a target given by mistake cannot
# change it.
ifdef TARGET
seed:
	@echo 'make seed does not take TARGET' >&2; exit 2
else
# The seed's compiler embeds std/ and runtime/ in seed mode, in a copy of compiler/, so that the
# build's own compiler/embedded.lerta stays as it is.
seed: check-bootstrap
	rm -rf build/seed-source
	cp -R compiler build/seed-source
	build/embed --seed build/seed-source/embedded.lerta $(EMBEDDED)
	bin/lerta dump-llvm build/seed-source/main.lerta > build/seed-source/lerta.ll
	cp build/seed-source/lerta.ll seed/lerta.ll
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
	nice $(MAKE) --no-print-directory check-bootstrap || status=1; \
	exit $$status

test-cross:
	@tools/test_cross.sh
endif

clean:
	rm -rf build bin compiler/embedded.lerta

# A command that fails leaves no file, such as half of an IR printed to a redirection.
.DELETE_ON_ERROR:

.PHONY: all check-bootstrap seed test test-cross clean
