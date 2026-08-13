/* unit tests for src/kvx.c — parser grammar, accessors, sort, surgical write */
#include "cg.h"
#include "tap.h"
#include <unistd.h>

static char tmppath[256];

static void write_tmp(const char *content) {
    if (write_entire_file(tmppath, content, strlen(content)) != 0) {
        fprintf(stderr, "cannot write %s\n", tmppath);
        exit(1);
    }
}

static const char *FIXTURE =
    "# leading comment\n"
    "[meta]\n"
    "name = \"Demo\"          # trailing comment\n"
    "hash_in_quotes = \"a # not-a-comment\"\n"
    "count = 42\n"
    "flag = \"true\"\n"
    "empty =\n"
    "dup = \"first\"\n"
    "dup = \"second\"\n"
    "env = \"pre-${TAP_KVX_ENV}-post\"\n"
    "env_missing = \"x${TAP_KVX_NOPE}y\"\n"
    "env_invalid = \"${1BAD}\"\n"
    "list = [\"a\", \"b, with comma\", \"c\"]\n"
    "scalar_as_list = \"solo\"\n"
    "\n"
    "[task.1]\n"
    "title = \"one\"\n"
    "\n"
    "[task.1.2]\n"
    "title = \"one-two\"\n"
    "\n"
    "[task.10]\n"
    "title = \"ten\"\n"
    "\n"
    "[task.2]\n"
    "title = \"two\"\n";

static void test_parse(void) {
    setenv("TAP_KVX_ENV", "VAL", 1);
    unsetenv("TAP_KVX_NOPE");
    write_tmp(FIXTURE);
    Kvx *k = kvx_parse(tmppath);
    ok(k != NULL, "fixture parses");
    if (!k) return;

    ok(kvx_has(k, "meta"), "has [meta]");
    ok(kvx_has(k, "task.1.2"), "has [task.1.2]");
    ok(!kvx_has(k, "nope"), "absent section");

    char *v = kvx_str(k, "meta", "name");
    ok_str(v, "Demo");                       /* comment stripped, unquoted */
    free(v);
    v = kvx_str(k, "meta", "hash_in_quotes");
    ok_str(v, "a # not-a-comment");          /* # inside quotes survives */
    free(v);
    ok(kvx_long(k, "meta", "count", -1) == 42, "kvx_long parses");
    ok(kvx_long(k, "meta", "missing", 7) == 7, "kvx_long default");
    ok(kvx_bool(k, "meta", "flag", false), "kvx_bool true");
    ok(kvx_bool(k, "meta", "missing", true), "kvx_bool default");
    ok(kvx_str(k, "meta", "missing") == NULL, "absent key is NULL");

    v = kvx_str(k, "meta", "dup");
    ok_str(v, "second");                     /* duplicate: last value wins */
    free(v);
    const char **keys;
    int nk = kvx_keys(k, "meta", &keys);
    int dup_at = -1;
    for (int i = 0; i < nk; i++)
        if (strcmp(keys[i], "dup") == 0) { dup_at = i; break; }
    ok(dup_at >= 0, "dup key present once");
    int dup_count = 0;
    for (int i = 0; i < nk; i++)
        if (strcmp(keys[i], "dup") == 0) dup_count++;
    ok(dup_count == 1, "duplicate keeps one slot (got %d)", dup_count);
    ok_str(keys[0], "name");                 /* file order preserved */
    free(keys);

    v = kvx_str(k, "meta", "env");
    ok_str(v, "pre-VAL-post");
    free(v);
    v = kvx_str(k, "meta", "env_missing");
    ok_str(v, "xy");                         /* missing env -> "" */
    free(v);
    v = kvx_str(k, "meta", "env_invalid");
    ok_str(v, "${1BAD}");                    /* non-identifier stays literal */
    free(v);

    char **items;
    int ni = kvx_list(k, "meta", "list", &items);
    ok(ni == 3, "list has 3 items (got %d)", ni);
    if (ni == 3) {
        ok_str(items[0], "a");
        ok_str(items[1], "b, with comma");   /* comma inside quotes kept */
        ok_str(items[2], "c");
    }
    for (int i = 0; i < ni; i++) free(items[i]);
    free(items);
    ni = kvx_list(k, "meta", "scalar_as_list", &items);
    ok(ni == 1, "scalar fallback list");
    if (ni == 1) ok_str(items[0], "solo");
    for (int i = 0; i < ni; i++) free(items[i]);
    free(items);

    char **subs;
    int ns = kvx_subsections(k, "task", &subs);
    ok(ns == 4, "4 task subsections (got %d)", ns);
    if (ns == 4) ok_str(subs[0], "1");       /* file order, not sorted */
    if (ns == 4) ok_str(subs[2], "10");
    kvx_sort_dotted(subs, ns);
    if (ns == 4) {
        ok_str(subs[0], "1");                /* numeric-segment sort */
        ok_str(subs[1], "1.2");
        ok_str(subs[2], "2");
        ok_str(subs[3], "10");
    }
    for (int i = 0; i < ns; i++) free(subs[i]);
    free(subs);
    kvx_free(k);
}

static void test_sort_edge(void) {
    char *ids[] = { xstrdup("1.10"), xstrdup("1.2"), xstrdup("1"),
                    xstrdup("1.2.1") };
    kvx_sort_dotted(ids, 4);
    ok_str(ids[0], "1");
    ok_str(ids[1], "1.2");
    ok_str(ids[2], "1.2.1");
    ok_str(ids[3], "1.10");
    for (int i = 0; i < 4; i++) free(ids[i]);
}

static void test_errors(void) {
    ok(kvx_parse("/nonexistent/x.kvx") == NULL, "missing file is NULL");
    write_tmp("[unterminated\n");
    ok(kvx_parse(tmppath) == NULL, "unterminated section header rejected");
    write_tmp("no equals sign here\n");
    ok(kvx_parse(tmppath) == NULL, "bare line rejected");
}

static void test_set_status(void) {
    const char *before =
        "# header comment stays\n"
        "[task.1]\n"
        "status = \"pending\"\n"
        "title = \"first\"\n"
        "\n"
        "[task.2]\n"
        "  status   = \"pending\"\n"
        "title = \"second\"   # kept\n";
    write_tmp(before);
    ok(kvx_set_status(tmppath, "task.2", "done") == 0, "set_status succeeds");
    char *after = read_entire_file(tmppath, NULL);
    const char *want =
        "# header comment stays\n"
        "[task.1]\n"
        "status = \"pending\"\n"          /* other section untouched */
        "title = \"first\"\n"
        "\n"
        "[task.2]\n"
        "  status   = \"done\"\n"         /* pre-'=' spacing preserved */
        "title = \"second\"   # kept\n";
    ok_str(after, want);
    free(after);

    ok(kvx_set_status(tmppath, "task.99", "done") == -2,
       "missing section reports -2");
    ok(kvx_set_status("/nonexistent/x.kvx", "task.1", "done") == -1,
       "missing file reports -1");
}

int main(void) {
    snprintf(tmppath, sizeof tmppath, "/tmp/cg_test_kvx_%d.kvx", getpid());
    test_parse();
    test_sort_edge();
    test_errors();
    test_set_status();
    unlink(tmppath);
    return t_done("kvx");
}
