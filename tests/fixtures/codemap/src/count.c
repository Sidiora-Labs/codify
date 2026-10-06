/* Counting: words and lines in a file, built on the text helpers. */
#include <stdio.h>
#include "tally.h"

int count_file(const char *path) {
    char *s = text_load(path);
    if (!s) return 1;
    printf("%d\n", text_words(s));
    text_free(s);
    return 0;
}

int count_lines(const char *path) {
    char *s = text_load(path);
    if (!s) return 1;
    int n = 0;
    for (const char *p = s; *p; p++) n += *p == '\n';
    printf("%d\n", n);
    text_free(s);
    return 0;
}
