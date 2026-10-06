CC ?= cc

all: tally

tally: src/main.c src/count.c src/text.c
	$(CC) -o $@ $^

test: tally
	$(CC) -o tests/run tests/test_count.c src/count.c src/text.c && tests/run

clean:
	rm -f tally tests/run
