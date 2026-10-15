#include "cg.h"
#include "sem_incremental.h"

extern int sem_pass_run(Cg *, const long *, int) __attribute__((weak));
extern bool sem_imports_config_changed(Cg *) __attribute__((weak));

static int table_exists(Cg *cg, const char *name) {
    sqlite3_stmt *q = cg_prep(cg,
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?1");
    sqlite3_bind_text(q, 1, name, -1, SQLITE_STATIC);
    int exists = sqlite3_step(q) == SQLITE_ROW;
    sqlite3_finalize(q);
    return exists;
}

void sem_incremental_init(Cg *cg) {
    cg_exec(cg,
        "CREATE TABLE IF NOT EXISTS semantic_change_debt("
        "branch_id INTEGER NOT NULL,file_id INTEGER NOT NULL,"
        "PRIMARY KEY(branch_id,file_id));"
        "CREATE TABLE IF NOT EXISTS semantic_change_keys("
        "branch_id INTEGER NOT NULL,kind TEXT NOT NULL,key TEXT NOT NULL,"
        "PRIMARY KEY(branch_id,kind,key));"
        "CREATE INDEX IF NOT EXISTS idx_sem_change_keys_branch "
        "ON semantic_change_keys(branch_id,kind);"
        "CREATE TRIGGER IF NOT EXISTS sem_debt_branch_delete "
        "AFTER DELETE ON branches BEGIN "
        "DELETE FROM semantic_change_debt WHERE branch_id=OLD.id;"
        "DELETE FROM semantic_change_keys WHERE branch_id=OLD.id; END;");
}

static void collect(Cg *cg, long file_id, const char *kind,
                    const char *query) {
    sqlite3_stmt *src = cg_prep(cg, query);
    sqlite3_stmt *dst = cg_prep(cg,
        "INSERT OR IGNORE INTO semantic_change_keys(branch_id,kind,key) "
        "VALUES(?1,?2,?3)");
    sqlite3_bind_int64(src, 1, file_id);
    while (sqlite3_step(src) == SQLITE_ROW) {
        const char *key = (const char *)sqlite3_column_text(src, 0);
        if (!key || !*key) continue;
        sqlite3_bind_int64(dst, 1, cg->branch_id);
        sqlite3_bind_text(dst, 2, kind, -1, SQLITE_STATIC);
        sqlite3_bind_text(dst, 3, key, -1, SQLITE_TRANSIENT);
        int rc = sqlite3_step(dst);
        if (rc != SQLITE_DONE) {
            fprintf(stderr, "cg: semantic change debt: %s\n", sqlite3_errmsg(cg->db));
            exit(2);
        }
        sqlite3_reset(dst);
        sqlite3_clear_bindings(dst);
    }
    sqlite3_finalize(src);
    sqlite3_finalize(dst);
}

void sem_incremental_note(Cg *cg, long file_id) {
    sqlite3_stmt *q = cg_prep(cg,
        "INSERT OR IGNORE INTO semantic_change_debt(branch_id,file_id) "
        "VALUES(?1,?2)");
    sqlite3_bind_int64(q, 1, cg->branch_id);
    sqlite3_bind_int64(q, 2, file_id);
    if (sqlite3_step(q) != SQLITE_DONE) {
        fprintf(stderr, "cg: semantic debt: %s\n", sqlite3_errmsg(cg->db));
        exit(2);
    }
    sqlite3_finalize(q);
    collect(cg, file_id, "symbol",
            "SELECT name FROM symbols WHERE file_id=?1");
    collect(cg, file_id, "dependency",
            "SELECT 'type:' || name FROM symbols WHERE file_id=?1");
    collect(cg, file_id, "path",
            "SELECT path FROM files WHERE id=?1");
    if (table_exists(cg, "semantic_bindings"))
        collect(cg, file_id, "module",
                "SELECT module FROM semantic_bindings WHERE file_id=?1");
    if (table_exists(cg, "semantic_dependencies"))
        collect(cg, file_id, "dependency",
                "SELECT dependency_key FROM semantic_dependencies WHERE file_id=?1");
    if (table_exists(cg, "semantic_type_facts"))
        collect(cg, file_id, "type",
                "SELECT name FROM semantic_type_facts WHERE file_id=?1");
    if (table_exists(cg, "semantic_type_facts"))
        collect(cg, file_id, "channel",
                "SELECT substr(kind,9)||':'||coalesce(name,'')||':'||"
                "coalesce(value,'') FROM semantic_type_facts "
                "WHERE file_id=?1 AND kind LIKE 'channel:%'");
    if (table_exists(cg, "routes"))
        collect(cg, file_id, "route",
                "SELECT pattern FROM routes WHERE file_id=?1");
}

int sem_incremental_pending(Cg *cg) {
    if (!table_exists(cg, "semantic_change_debt")) return 0;
    sqlite3_stmt *q = cg_prep(cg,
        "SELECT 1 FROM semantic_change_debt WHERE branch_id=?1 LIMIT 1");
    sqlite3_bind_int64(q, 1, cg->branch_id);
    int pending = sqlite3_step(q) == SQLITE_ROW;
    sqlite3_finalize(q);
    return pending;
}

int sem_incremental_needs_run(Cg *cg) {
    return sem_incremental_pending(cg) ||
           (sem_imports_config_changed && sem_imports_config_changed(cg));
}

static void add_ids(Cg *cg, const char *sql, long **ids, int *n, int *cap) {
    sqlite3_stmt *q = cg_prep(cg, sql);
    sqlite3_bind_int64(q, 1, cg->branch_id);
    while (sqlite3_step(q) == SQLITE_ROW) {
        long id = sqlite3_column_int64(q, 0);
        if (*n == *cap) {
            *cap = *cap ? *cap * 2 : 64;
            *ids = xrealloc(*ids, sizeof(long) * (size_t)*cap);
        }
        (*ids)[(*n)++] = id;
    }
    sqlite3_finalize(q);
}

/* The changed-key index expands a small edit to exactly its known users.
 * Unknown references are retained and selected by their original spelling,
 * so adding a previously missing definition can revive them. */
static void affected(Cg *cg, long **ids, int *n) {
    int cap = 0;
    add_ids(cg,
        "SELECT DISTINCT file_id FROM semantic_change_debt WHERE branch_id=?1",
        ids,n,&cap);
    if (table_exists(cg, "semantic_dependencies"))
        add_ids(cg,
            "SELECT DISTINCT d.file_id FROM semantic_dependencies d "
            "JOIN semantic_change_keys k ON k.branch_id=d.branch_id "
            "AND k.key=d.dependency_key "
            "WHERE d.branch_id=?1 AND EXISTS(SELECT 1 FROM files f "
            "WHERE f.id=d.file_id AND f.branch_id=?1)",ids,n,&cap);
    if (table_exists(cg, "semantic_references"))
        add_ids(cg,
            "SELECT DISTINCT r.file_id FROM semantic_references r "
            "JOIN refs raw ON raw.id=r.ref_id "
            "JOIN semantic_change_keys k ON k.branch_id=?1 "
            "AND k.kind='symbol' AND k.key=raw.name "
            "JOIN files f ON f.id=r.file_id AND f.branch_id=?1 "
            "WHERE raw.name IS NOT NULL",ids,n,&cap);
    if (table_exists(cg, "semantic_bindings"))
        add_ids(cg,
            "SELECT DISTINCT b.file_id FROM semantic_bindings b "
            "JOIN semantic_change_keys k ON k.branch_id=?1 "
            "AND (k.key=b.module OR k.key=b.original_name) "
            "JOIN files f ON f.id=b.file_id AND f.branch_id=?1",ids,n,&cap);
    if (table_exists(cg, "semantic_type_facts"))
        add_ids(cg,
            "SELECT DISTINCT t.file_id FROM semantic_type_facts t "
            "JOIN semantic_change_keys k ON k.branch_id=?1 "
            "AND k.kind='symbol' AND (k.key=t.name OR k.key=t.value) "
            "JOIN files f ON f.id=t.file_id AND f.branch_id=?1",ids,n,&cap);
}

static void collect_new(Cg *cg) {
    sqlite3_stmt *q = cg_prep(cg,
        "SELECT file_id FROM semantic_change_debt WHERE branch_id=?1 "
        "AND file_id IN (SELECT id FROM files WHERE branch_id=?1)");
    sqlite3_bind_int64(q,1,cg->branch_id);
    while (sqlite3_step(q)==SQLITE_ROW) {
        long id=sqlite3_column_int64(q,0);
        collect(cg,id,"symbol","SELECT name FROM symbols WHERE file_id=?1");
        collect(cg,id,"dependency",
                "SELECT 'type:' || name FROM symbols WHERE file_id=?1");
        collect(cg,id,"path","SELECT path FROM files WHERE id=?1");
        if (table_exists(cg,"semantic_bindings"))
            collect(cg,id,"module",
                    "SELECT module FROM semantic_bindings WHERE file_id=?1");
        if (table_exists(cg,"semantic_dependencies"))
            collect(cg,id,"dependency",
                    "SELECT dependency_key FROM semantic_dependencies WHERE file_id=?1");
        if (table_exists(cg,"semantic_type_facts"))
            collect(cg,id,"type",
                    "SELECT name FROM semantic_type_facts WHERE file_id=?1");
        if (table_exists(cg,"semantic_type_facts"))
            collect(cg,id,"channel",
                    "SELECT substr(kind,9)||':'||coalesce(name,'')||':'||"
                    "coalesce(value,'') FROM semantic_type_facts "
                    "WHERE file_id=?1 AND kind LIKE 'channel:%'");
        collect(cg,id,"route","SELECT pattern FROM routes WHERE file_id=?1");
    }
    sqlite3_finalize(q);
}

static int long_cmp(const void *a, const void *b) {
    long x=*(const long *)a, y=*(const long *)b;
    return (x>y)-(x<y);
}

int sem_incremental_run(Cg *cg, int force_full) {
    sem_incremental_init(cg);
    int config_changed = sem_imports_config_changed &&
                         sem_imports_config_changed(cg);
    int pending = sem_incremental_pending(cg);
    if (!pending && !config_changed && !force_full) return 0;
    if (pending) collect_new(cg);
    long *ids = NULL;
    int n = 0;
    if (!force_full && !config_changed) {
        affected(cg, &ids, &n);
        qsort(ids, (size_t)n, sizeof(long), long_cmp);
        int out=0;
        for (int i=0;i<n;i++) if (!out || ids[i]!=ids[out-1]) ids[out++]=ids[i];
        n=out;
    }
    /* A deletion may leave no live changed file. A NULL request still asks
     * all passes to clear incoming links and retry unresolved references. */
    int full = force_full || config_changed || (pending && n==0);
    int rc = sem_pass_run ? sem_pass_run(cg, full ? NULL : ids, n) : -1;
    free(ids);
    if (rc != 0) return rc;
    const char *failpoint = getenv("CG_SEM_FAIL_BEFORE_PUBLISH");
    if (failpoint && strcmp(failpoint,"1")==0) return -1;
    sqlite3_stmt *q = cg_prep(cg,
        "DELETE FROM semantic_change_debt WHERE branch_id=?1");
    sqlite3_bind_int64(q,1,cg->branch_id);
    sqlite3_step(q); sqlite3_finalize(q);
    q = cg_prep(cg,"DELETE FROM semantic_change_keys WHERE branch_id=?1");
    sqlite3_bind_int64(q,1,cg->branch_id);
    sqlite3_step(q); sqlite3_finalize(q);
    char key[64], val[64];
    cg_bkey(cg,"semantic_generation",key,sizeof key);
    char *old=cg_meta_get(cg,key);
    snprintf(val,sizeof val,"%lld",(long long)(old ? atoll(old) : 0)+1);
    free(old);
    cg_meta_set(cg,key,val);
    return 0;
}
