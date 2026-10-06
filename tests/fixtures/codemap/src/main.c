/* The tally command line: one subcommand per verb. */
#include <stdio.h>
#include <string.h>
#include "tally.h"

int main(int argc, char **argv) {
    if (argc < 2) return 2;
    const char *cmd = argv[1];
    if (strcmp(cmd, "count") == 0) return count_file(argc > 2 ? argv[2] : "-");
    if (strcmp(cmd, "lines") == 0) return count_lines(argc > 2 ? argv[2] : "-");
    if (strcmp(cmd, "help") == 0) { puts("tally count|lines FILE"); return 0; }
    return 2;
}
