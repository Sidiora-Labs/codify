#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "helpers.h"

/* A struct definition — should be recorded */
struct Config {
    int verbose;
    char *name;
};

/* A type use, not a definition — should NOT be recorded as def of stat */
static int check_path(const char *path) {
    struct stat st;
    if (stat(path, &st) < 0) return -1;
    return 0;
}

/* Forward declaration — should be recorded */
struct Opaque;

/* typedef struct — should be recorded */
typedef struct Node {
    int value;
    struct Node *next;
} Node;

/* enum definition */
enum Level { LOW, MEDIUM, HIGH };

/* enum use, not a definition */
static enum Level current = LOW;

/* Prototype — should NOT create a separate symbol */
int helpers_init(int flags);

/* Definition — should be the one recorded */
int helpers_init(int flags) {
    (void)flags;
    printf("init\n");
    return check_path(".");
}
