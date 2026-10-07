/* unit tests for src/config.c — defaults, parsing, path validation, the
 * [index] workers count, the per-root cache, and spec root discovery */
#include "cg.h"
#include "tap.h"
#include <unistd.h>
#include <sys/stat.h>

static char base[256];

/* a fresh project directory under base holding `body` as codify.kvx
 * (NULL: no file) */
static void project(char *out, size_t cap, const char *name, const char *body) {
    snprintf(out, cap, "%s/%s", base, name);
    mkdir(out, 0755);
    if (!body) return;
    char f[600];
    snprintf(f, sizeof f, "%s/%s", out, CG_CONFIG_FILE);
    if (write_entire_file(f, body, strlen(body)) != 0) {
        fprintf(stderr, "cannot write %s\n", f);
        exit(1);
    }
}

/* config_load with its one-time stderr warning muted */
static const CgConfig *quiet_load(const char *root) {
    fflush(stderr);
    int saved = dup(2);
    FILE *null = freopen("/dev/null", "w", stderr);
    (void)null;
    const CgConfig *c = config_load(root);
    fflush(stderr);
    dup2(saved, 2);
    close(saved);
    return c;
}

int main(void) {
    snprintf(base, sizeof base, "/tmp/cg_test_config_XXXXXX");
    if (!mkdtemp(base)) { perror("mkdtemp"); return 1; }
    char root[512], p[4700];

    /* ---- no file: the defaults, byte for byte */
    project(root, sizeof root, "none", NULL);
    const CgConfig *c = config_load(root);
    ok(!c->present, "absent file is not present");
    ok(c->sync_auto, "auto-sync defaults on");
    ok_str(c->spec, "spec");
    ok_str(c->context, ".codify");
    ok_str(c->skills, ".agents/skills");
    ok_str(c->codemap, "CODEMAP.md");
    ok(c->index_workers == 0, "workers default to auto (0)");
    ok(config_index_workers(root) == 0, "accessor: auto");
    ok(c->nproblems == 0, "no problems without a file");
    for (int i = 0; i < CFG_NKEYS; i++)
        ok(!c->from_file[i], "key %d not from the file", i);
    config_spec_dir(root, p, sizeof p);
    char want[4700];
    snprintf(want, sizeof want, "%s/spec", root);
    ok_str(p, want);
    config_workflow_path(root, p, sizeof p);
    snprintf(want, sizeof want, "%s/spec/workflow.kvx", root);
    ok_str(p, want);
    config_feature_path(root, "demo", p, sizeof p);
    snprintf(want, sizeof want, "%s/spec/demo/spec.kvx", root);
    ok_str(p, want);
    config_context_path(root, "agent-context.md", p, sizeof p);
    snprintf(want, sizeof want, "%s/%s", root, CG_AGENT_CONTEXT);
    ok_str(p, want);
    config_codemap_path(root, p, sizeof p);
    snprintf(want, sizeof want, "%s/CODEMAP.md", root);
    ok_str(p, want);
    ok(config_in_spec(root, "spec/demo/spec.kvx"), "spec/ is in spec");
    ok(!config_in_spec(root, "specs/x"), "specs/ is not spec/");
    ok(!config_in_spec(root, "spec"), "the bare name is not inside");

    /* ---- parsing: every key, comments, quoting, normalization */
    project(root, sizeof root, "full",
            "# header\n"
            "[sync]\n"
            "auto = false   # off\n"
            "\n"
            "[paths]\n"
            "spec    = \"./planning//specs/\"\n"
            "context = \"state/ctx\"\n"
            "skills  = tools/skills\n"
            "codemap = \"docs/MAP.md\"\n"
            "[index]\n"
            "workers = 8   # a bigger machine\n");
    c = config_load(root);
    ok(c->present, "file present");
    ok(c->index_workers == 8, "workers = 8 parsed (%d)", c->index_workers);
    ok(config_index_workers(root) == 8, "workers accessor agrees");
    ok(!c->sync_auto, "auto = false parsed");
    ok_str(c->spec, "planning/specs");
    ok_str(c->context, "state/ctx");
    ok_str(c->skills, "tools/skills");
    ok_str(c->codemap, "docs/MAP.md");
    for (int i = 0; i < CFG_NKEYS; i++)
        ok(c->from_file[i], "key %d from the file", i);
    ok(!config_auto_sync(root), "accessor agrees");
    ok_str(config_spec_rel(root), "planning/specs");
    config_feature_path(root, "f", p, sizeof p);
    snprintf(want, sizeof want, "%s/planning/specs/f/spec.kvx", root);
    ok_str(p, want);
    config_skills_dir(root, p, sizeof p);
    snprintf(want, sizeof want, "%s/tools/skills", root);
    ok_str(p, want);
    config_context_dir(root, p, sizeof p);
    snprintf(want, sizeof want, "%s/state/ctx", root);
    ok_str(p, want);
    ok(config_in_spec(root, "planning/specs/f/spec.kvx"), "configured in spec");
    ok(!config_in_spec(root, "spec/f/spec.kvx"), "default dir no longer spec");

    /* ---- booleans: the accepted spellings */
    const char *yes[] = { "true", "yes", "on", "1", "\"true\"" };
    const char *no[] = { "false", "no", "off", "0", "\"off\"" };
    for (int i = 0; i < 5; i++) {
        char name[32], body[64];
        snprintf(name, sizeof name, "yes%d", i);
        snprintf(body, sizeof body, "[sync]\nauto = %s\n", yes[i]);
        project(root, sizeof root, name, body);
        ok(config_auto_sync(root), "auto = %s is on", yes[i]);
        snprintf(name, sizeof name, "no%d", i);
        snprintf(body, sizeof body, "[sync]\nauto = %s\n", no[i]);
        project(root, sizeof root, name, body);
        ok(!config_auto_sync(root), "auto = %s is off", no[i]);
    }

    /* ---- rejected values fall back to the default and are counted */
    const char *bad[] = { "\"/abs/spec\"", "\"../out\"", "\"a/../../b\"",
                          "\"\"", "\".\"", "\"~/spec\"", "\".git/spec\"",
                          "\".codegraph\"", "\"a\\\\b\"" };
    int nbad = (int)(sizeof bad / sizeof bad[0]);
    for (int i = 0; i < nbad; i++) {
        char name[32], body[128];
        snprintf(name, sizeof name, "bad%d", i);
        snprintf(body, sizeof body, "[paths]\nspec = %s\n", bad[i]);
        project(root, sizeof root, name, body);
        c = quiet_load(root);
        ok_str(c->spec, "spec");
        ok(!c->from_file[CFG_PATH_SPEC], "rejected %s not from the file", bad[i]);
        ok(c->nproblems == 1, "rejected %s counted (%d)", bad[i], c->nproblems);
    }
    /* .. that stays inside is fine once normalized */
    project(root, sizeof root, "inner", "[paths]\nspec = \"a/../plan\"\n");
    ok_str(config_spec_rel(root), "plan");
    project(root, sizeof root, "badbool", "[sync]\nauto = maybe\n");
    c = quiet_load(root);
    ok(c->sync_auto && c->nproblems == 1, "bad bool keeps the default");

    /* ---- [index] workers: the parser every source shares */
    ok(config_parse_workers("auto") == 0, "auto is 0");
    ok(config_parse_workers("AUTO") == 0, "auto is case-blind");
    ok(config_parse_workers("0") == 0, "0 is auto");
    ok(config_parse_workers("1") == 1, "1");
    ok(config_parse_workers("64") == CG_MAX_WORKERS, "64 is the cap");
    ok(config_parse_workers(" 12 ") == 12, "blanks around a count");
    const char *nw[] = { "65", "-1", "+3", "3.5", "x", "", "8x", "1e2",
                         "99999999999999999999" };
    for (int i = 0; i < (int)(sizeof nw / sizeof nw[0]); i++)
        ok(config_parse_workers(nw[i]) == -1, "'%s' rejected", nw[i]);
    ok(config_parse_workers(NULL) == -1, "NULL rejected");
    ok(CG_MAX_WORKERS == 64, "the pipeline cap is 64");

    /* in the file: quoted or bare, auto, and the bad ones fall back */
    const char *goodw[] = { "1", "64", "\"16\"", "auto", "\"auto\"", "0" };
    const int   wantw[] = { 1, 64, 16, 0, 0, 0 };
    for (int i = 0; i < 6; i++) {
        char name[32], body[96];
        snprintf(name, sizeof name, "w%d", i);
        snprintf(body, sizeof body, "[index]\nworkers = %s\n", goodw[i]);
        project(root, sizeof root, name, body);
        c = quiet_load(root);
        ok(c->index_workers == wantw[i] && c->nproblems == 0,
           "workers = %s -> %d (%d, %d problems)", goodw[i], wantw[i],
           c->index_workers, c->nproblems);
        ok(c->from_file[CFG_INDEX_WORKERS], "workers = %s from the file",
           goodw[i]);
    }
    const char *badw[] = { "65", "-2", "many", "2.5", "\"\"" };
    for (int i = 0; i < 5; i++) {
        char name[32], body[96];
        snprintf(name, sizeof name, "wbad%d", i);
        snprintf(body, sizeof body, "[index]\nworkers = %s\n", badw[i]);
        project(root, sizeof root, name, body);
        c = quiet_load(root);
        ok(c->index_workers == 0, "workers = %s falls back to auto", badw[i]);
        ok(!c->from_file[CFG_INDEX_WORKERS], "workers = %s not from the file",
           badw[i]);
        ok(c->nproblems == 1, "workers = %s counted (%d)", badw[i],
           c->nproblems);
        StrBuf wt; sb_init(&wt);
        ok(config_check(root, &wt, NULL) == 1, "check names workers = %s",
           badw[i]);
        ok(strstr(wt.p, "[index] workers") && strstr(wt.p, CG_CONFIG_FILE),
           "the message names the key and file: %s", wt.p);
        sb_free(&wt);
    }

    /* ---- config_check: unknown sections and keys, bad values */
    project(root, sizeof root, "unknown",
            "[sync]\nauto = true\ndebounce = 3\n"
            "[paths]\nspec = \"/x\"\nskils = \"y\"\n"
            "[extra]\nk = 1\n");
    StrBuf t, j;
    sb_init(&t); sb_init(&j);
    fflush(stderr);
    int saved = dup(2);
    FILE *null = freopen("/dev/null", "w", stderr);
    (void)null;
    int n = config_check(root, &t, &j);
    fflush(stderr);
    dup2(saved, 2);
    close(saved);
    ok(n == 4, "4 problems, got %d", n);
    ok(strstr(t.p, "unknown section [extra]") != NULL, "unknown section: %s", t.p);
    ok(strstr(t.p, "unknown key debounce in [sync]") != NULL, "unknown key");
    ok(strstr(t.p, "unknown key skils in [paths]") != NULL, "unknown path key");
    ok(strstr(t.p, CG_CONFIG_FILE) != NULL, "names the file");
    ok(strstr(j.p, "\"ok\":false") != NULL, "json ok false: %s", j.p);
    ok(strstr(j.p, "\"kind\":\"bad_value\"") != NULL, "json bad_value");
    sb_free(&t); sb_free(&j);
    project(root, sizeof root, "clean", "[sync]\nauto = true\n");
    sb_init(&t); sb_init(&j);
    ok(config_check(root, &t, &j) == 0, "clean file has no problems");
    ok(strstr(j.p, "\"ok\":true") != NULL, "json ok true");
    sb_free(&t); sb_free(&j);

    /* ---- the cache: one load per root, keyed by root, trailing / ignored */
    project(root, sizeof root, "cache", "[paths]\nspec = \"one\"\n");
    const CgConfig *a = config_load(root);
    char f[600];
    snprintf(f, sizeof f, "%s/%s", root, CG_CONFIG_FILE);
    write_entire_file(f, "[paths]\nspec = \"two\"\n", 21);
    const CgConfig *b = config_load(root);
    ok(a == b, "same root, same entry");
    ok_str(b->spec, "one");
    char slash[600];
    snprintf(slash, sizeof slash, "%s/", root);
    ok(config_load(slash) == a, "a trailing slash is the same root");
    char other[512];
    project(other, sizeof other, "cache2", "[paths]\nspec = \"two\"\n");
    ok(config_load(other) != a, "another root, another entry");
    ok_str(config_spec_rel(other), "two");

    /* ---- spec root discovery walks up through the configured directory */
    project(root, sizeof root, "walk", "[paths]\nspec = \"planning/specs\"\n");
    char d[4700];
    snprintf(d, sizeof d, "%s/planning/specs/demo", root);
    mkdirs(d);
    snprintf(d, sizeof d, "%s/planning/specs/workflow.kvx", root);
    write_entire_file(d, "[meta]\n", 7);
    snprintf(d, sizeof d, "%s/src/deep", root);
    mkdirs(d);
    char found[4096];
    ok(config_find_spec_root(d, found, sizeof found) == 0, "found from src/deep");
    ok_str(found, root);
    snprintf(d, sizeof d, "%s/planning/specs/demo", root);
    ok(config_find_spec_root(d, found, sizeof found) == 0, "found from the spec dir");
    ok_str(found, root);

    char cmd[600];
    snprintf(cmd, sizeof cmd, "rm -rf %s", base);
    if (system(cmd) != 0) { /* best effort */ }
    return t_done("config");
}
