/* unit tests for src/util.c — StrBuf, file IO, binary sniff, path helpers */
#include "cg.h"
#include "tap.h"
#include <unistd.h>

int main(void) {
    /* StrBuf */
    StrBuf b; sb_init(&b);
    sb_puts(&b, "hello");
    sb_putc(&b, ' ');
    sb_printf(&b, "%s %d", "world", 42);
    ok_str(b.p, "hello world 42");
    ok(b.len == strlen("hello world 42"), "len tracks content");
    sb_free(&b);

    sb_init(&b);
    for (int i = 0; i < 10000; i++) sb_puts(&b, "x");
    ok(b.len == 10000, "growth across reallocs");
    sb_free(&b);

    sb_init(&b);
    sb_json_str(&b, "a\"b\\c\nd\te");
    ok_str(b.p, "\"a\\\"b\\\\c\\nd\\te\"");
    sb_free(&b);

    /* read_entire_file: regression for the fseek/ftell bug — /proc files
       report size 0 but must still read non-empty */
    size_t len = 0;
    char *body = read_entire_file("/proc/self/status", &len);
    ok(body != NULL && len > 0, "/proc file reads non-empty");
    ok(body && strstr(body, "Pid:") != NULL, "/proc content sane");
    free(body);

    /* write/read roundtrip preserves exact bytes and reports exact length */
    char path[256];
    snprintf(path, sizeof path, "/tmp/cg_test_util_%d.bin", getpid());
    const char payload[] = "line1\nline2\r\nno-trailing-newline";
    ok(write_entire_file(path, payload, sizeof payload - 1) == 0, "write ok");
    body = read_entire_file(path, &len);
    ok(len == sizeof payload - 1, "roundtrip length (got %zu)", len);
    ok(body && memcmp(body, payload, len) == 0, "roundtrip bytes");
    ok(body && body[len] == 0, "read result NUL-terminated");
    free(body);
    unlink(path);

    ok(read_entire_file("/nonexistent/nope", NULL) == NULL,
       "missing file is NULL");

    /* mkdirs */
    char deep[256];
    snprintf(deep, sizeof deep, "/tmp/cg_test_util_%d/a/b/c", getpid());
    ok(mkdirs(deep) == 0, "mkdirs -p");
    ok(access(deep, F_OK) == 0, "deep dir exists");
    snprintf(deep, sizeof deep, "rm -rf /tmp/cg_test_util_%d", getpid());
    if (system(deep) != 0) { /* best-effort cleanup */ }

    /* binary sniff + extension */
    ok(!looks_binary("plain text\n", 11), "text is not binary");
    ok(looks_binary("ab\0cd", 5), "NUL means binary");
    ok_str(path_ext("a/b/file.tar.gz"), ".gz");
    ok_str(path_ext("noext"), "");
    ok_str(path_ext("dir.v2/noext"), "");    /* dot in dir, not in base */

    /* generated root build output is ignored without hiding authored rules
       in conventional nested paths such as tools/build. */
    Ignore ig;
    ignore_load(&ig, "/tmp/cg-no-ignore-file-here");
    ok(ignore_match(&ig, "build", true), "root build directory ignored");
    ok(!ignore_match(&ig, "tools/build", true), "nested tools/build retained");
    ok(ignore_match(&ig, "node_modules", true), "other defaults unchanged");
    ignore_free(&ig);

    return t_done("util");
}
