/* minimal single-header test harness for Codify unit tests */
#ifndef TAP_H
#define TAP_H
#include <stdio.h>
#include <string.h>
#include <stdlib.h>

static int t_run = 0, t_fail = 0;

#define ok(cond, ...) do { \
    t_run++; \
    if (!(cond)) { \
        t_fail++; \
        printf("  FAIL %s:%d: ", __FILE__, __LINE__); \
        printf(__VA_ARGS__); \
        printf("\n"); \
    } \
} while (0)

#define ok_str(got, want) do { \
    const char *g_ = (got), *w_ = (want); \
    t_run++; \
    if (!g_ || strcmp(g_, w_) != 0) { \
        t_fail++; \
        printf("  FAIL %s:%d: got \"%s\", want \"%s\"\n", __FILE__, __LINE__, \
               g_ ? g_ : "(null)", w_); \
    } \
} while (0)

static int t_done(const char *name) {
    printf("%-16s %3d/%-3d %s\n", name, t_run - t_fail, t_run,
           t_fail ? "FAIL" : "ok");
    return t_fail ? 1 : 0;
}

#endif
