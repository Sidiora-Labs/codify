/* Text helpers: load a whole file and split it into words. */
#include <ctype.h>
#include <stdio.h>
#include <stdlib.h>
#include "tally.h"

char *text_load(const char *path) {
    FILE *f = fopen(path, "rb");
    if (!f) return NULL;
    char *buf = malloc(1 << 20);
    size_t n = fread(buf, 1, (1 << 20) - 1, f);
    buf[n] = 0;
    fclose(f);
    return buf;
}

int text_words(const char *s) {
    int n = 0, in = 0;
    for (; *s; s++) {
        if (isspace((unsigned char)*s)) in = 0;
        else if (!in) { in = 1; n++; }
    }
    return n;
}

void text_free(char *s) { free(s); }
