# Codify — agent-native code graph + version control, pure C11.
# Targets: all (default), test, unit, integration, install, uninstall, clean

CC       ?= cc
CFLAGS   ?= -O2
CFLAGS   += -std=gnu11 -Wall -Wextra -pthread
LDLIBS    = -lsqlite3 -lpthread -lm
PREFIX   ?= /usr/local
BUILD     = build

BIN       = cg
SRCS      = $(wildcard src/*.c)
OBJS      = $(patsubst src/%.c,$(BUILD)/%.o,$(SRCS))
LIB       = $(BUILD)/libcg.a          # everything except main.o, for tests

UNIT_SRCS = $(wildcard tests/unit/test_*.c)
UNIT_BINS = $(patsubst tests/unit/%.c,$(BUILD)/%,$(UNIT_SRCS))

all: $(BIN)

$(BIN): $(OBJS)
	$(CC) $(CFLAGS) -o $@ $(OBJS) $(LDLIBS)

$(BUILD)/%.o: src/%.c src/cg.h | $(BUILD)
	$(CC) $(CFLAGS) -c -o $@ $<

$(LIB): $(filter-out $(BUILD)/main.o,$(OBJS))
	ar rcs $@ $^

$(BUILD)/test_%: tests/unit/test_%.c $(LIB)
	$(CC) $(CFLAGS) -Isrc -o $@ $< $(LIB) $(LDLIBS)

$(BUILD):
	mkdir -p $(BUILD)

unit: $(UNIT_BINS)
	@fail=0; for t in $(UNIT_BINS); do ./$$t || fail=1; done; exit $$fail

integration: $(BIN)
	@CG=$(CURDIR)/$(BIN) tests/run.sh

test: unit integration

install: $(BIN)
	install -m 755 $(BIN) $(PREFIX)/bin/$(BIN)

uninstall:
	rm -f $(PREFIX)/bin/$(BIN)

clean:
	rm -rf $(BUILD) $(BIN)

.PHONY: all unit integration test install uninstall clean
