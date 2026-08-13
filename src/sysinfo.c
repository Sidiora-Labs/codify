/*
 * Machine detection: container-aware core counts, honest available RAM.
 * Sources, most restrictive wins:
 *   cores:  online CPUs, sched_getaffinity mask, cgroup v1/v2 cpu quota
 *   memory: /proc/meminfo MemAvailable, cgroup v1/v2 memory limit-current
 */
#include "cg.h"
#include <unistd.h>
#include <sched.h>

static char *slurp(const char *path) {
    return read_entire_file(path, NULL);
}

/* cgroup v2: "max 100000" or "200000 100000" (quota period) */
static double cgroup_cpu_quota(void) {
    char *s = slurp("/sys/fs/cgroup/cpu.max");
    if (s) {
        double quota, period;
        if (strncmp(s, "max", 3) == 0) { free(s); return -1; }
        if (sscanf(s, "%lf %lf", &quota, &period) == 2 && period > 0) {
            free(s);
            return quota / period;
        }
        free(s);
    }
    char *q = slurp("/sys/fs/cgroup/cpu/cpu.cfs_quota_us");
    char *p = slurp("/sys/fs/cgroup/cpu/cpu.cfs_period_us");
    double r = -1;
    if (q && p) {
        double quota = atof(q), period = atof(p);
        if (quota > 0 && period > 0) r = quota / period;
    }
    free(q); free(p);
    return r;
}

/* returns limit-current in kb, or -1 when unlimited/unknown */
static long cgroup_mem_avail_kb(long *limit_kb_out) {
    long limit = -1, current = -1;
    char *s = slurp("/sys/fs/cgroup/memory.max");            /* v2 */
    if (s) {
        if (strncmp(s, "max", 3) != 0) limit = atol(s) / 1024;
        free(s);
        s = slurp("/sys/fs/cgroup/memory.current");
        if (s) { current = atol(s) / 1024; free(s); }
    } else {                                                  /* v1 */
        s = slurp("/sys/fs/cgroup/memory/memory.limit_in_bytes");
        if (s) {
            long v = atol(s) / 1024;
            free(s);
            if (v > 0 && v < (long)1 << 40) limit = v;       /* huge = no limit */
            s = slurp("/sys/fs/cgroup/memory/memory.usage_in_bytes");
            if (s) { current = atol(s) / 1024; free(s); }
        }
    }
    if (limit_kb_out) *limit_kb_out = limit;
    if (limit < 0) return -1;
    long avail = limit - (current > 0 ? current : 0);
    return avail > 0 ? avail : 0;
}

static void proc_meminfo(long *total_kb, long *avail_kb) {
    *total_kb = *avail_kb = -1;
    char *s = slurp("/proc/meminfo");
    if (!s) return;
    char *line = strstr(s, "MemTotal:");
    if (line) sscanf(line, "MemTotal: %ld", total_kb);
    line = strstr(s, "MemAvailable:");
    if (line) sscanf(line, "MemAvailable: %ld", avail_kb);
    free(s);
}

void sysinfo_detect(SysInfo *si) {
    memset(si, 0, sizeof *si);

    long online = sysconf(_SC_NPROCESSORS_ONLN);
    si->cores_online = online > 0 ? (int)online : 1;

    si->cores_affinity = si->cores_online;
#ifdef __linux__
    cpu_set_t set;
    if (sched_getaffinity(0, sizeof set, &set) == 0) {
        int n = CPU_COUNT(&set);
        if (n > 0) si->cores_affinity = n;
    }
#endif
    si->cores_quota = cgroup_cpu_quota();

    int eff = si->cores_online;
    if (si->cores_affinity < eff) eff = si->cores_affinity;
    if (si->cores_quota > 0) {
        int q = (int)(si->cores_quota + 0.999);   /* round up: 1.5 cores -> 2 */
        if (q < eff) eff = q;
    }
    si->cores_effective = eff > 0 ? eff : 1;

    proc_meminfo(&si->mem_total_kb, &si->mem_avail_kb);
    long cg_avail = cgroup_mem_avail_kb(&si->cg_mem_limit_kb);
    if (cg_avail >= 0 && (si->mem_avail_kb < 0 || cg_avail < si->mem_avail_kb))
        si->mem_avail_kb = cg_avail;
    if (si->mem_avail_kb < 0) si->mem_avail_kb = 256 * 1024;  /* conservative */

    /* Size the pipeline from what we actually have. */
    int w = si->cores_effective;
    if (w > 16) w = 16;
    if (si->mem_avail_kb < 300 * 1024 && w > 2) w = 2;   /* < 300MB: stay lean */
    if (si->mem_avail_kb < 120 * 1024) w = 1;
    si->workers = w > 0 ? w : 1;

    long cache = si->mem_avail_kb / 8;
    if (cache < 2 * 1024) cache = 2 * 1024;
    if (cache > 256 * 1024) cache = 256 * 1024;
    si->db_cache_kb = (int)cache;

    long mm = si->mem_avail_kb / 4 * 1024L;
    if (mm < 16L * 1024 * 1024) mm = 16L * 1024 * 1024;
    if (mm > 1024L * 1024 * 1024) mm = 1024L * 1024 * 1024;
    si->mmap_bytes = mm;

    if (si->cores_effective >= 8 && si->mem_avail_kb > 4L * 1024 * 1024)
        si->profile = "workstation";
    else if (si->cores_effective >= 2 && si->mem_avail_kb > 700 * 1024)
        si->profile = "constrained";
    else
        si->profile = "minimal";
}
