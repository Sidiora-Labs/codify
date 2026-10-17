#ifndef HF_PREPARATION_SUPPORT_H
#define HF_PREPARATION_SUPPORT_H
#define _GNU_SOURCE
#include <ctype.h>
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <openssl/evp.h>
#include <poll.h>
#include <signal.h>
#include <sqlite3.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/resource.h>
#include <sys/stat.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>
static inline int hp_hash_bytes(const void *data, size_t n, char out[65]) {
  unsigned char bytes[EVP_MAX_MD_SIZE];
  unsigned length = 0;
  if (EVP_Digest(data, n, bytes, &length, EVP_sha256(), NULL) != 1 ||
      length != 32)
    return 0;
  for (unsigned i = 0; i < length; i++)
    sprintf(out + i * 2, "%02x", bytes[i]);
  out[64] = 0;
  return 1;
}
static volatile sig_atomic_t hp_cancelled;

/* SQLite's JSON decoder is used rather than searching attacker-controlled JSON
 * text. Escaped duplicate keys are rejected throughout the input tree. */
static inline int hp_valid(const char *raw) {
  sqlite3 *db = NULL;
  sqlite3_stmt *s = NULL;
  int ok = 0;
  if (!raw || strlen(raw) > 67108864 ||
      sqlite3_open(":memory:", &db) != SQLITE_OK)
    goto done;
  if (sqlite3_prepare_v2(db, "SELECT json_valid(?1) AND json_type(?1)='object'",
                         -1, &s, NULL) != SQLITE_OK)
    goto done;
  sqlite3_bind_text(s, 1, raw, -1, SQLITE_TRANSIENT);
  if (sqlite3_step(s) != SQLITE_ROW || !sqlite3_column_int(s, 0))
    goto done;
  sqlite3_finalize(s);
  s = NULL;
  if (sqlite3_prepare_v2(db,
                         "SELECT 1 FROM json_tree(?1) WHERE typeof(key)='text' "
                         "GROUP BY parent,key HAVING count(*)>1 LIMIT 1",
                         -1, &s, NULL) != SQLITE_OK)
    goto done;
  sqlite3_bind_text(s, 1, raw, -1, SQLITE_TRANSIENT);
  ok = sqlite3_step(s) == SQLITE_DONE;
done:
  sqlite3_finalize(s);
  if (db)
    sqlite3_close(db);
  return ok;
}
static inline char *hp_get(const char *raw, const char *key, int index,
                           int indexed) {
  sqlite3 *db = NULL;
  sqlite3_stmt *s = NULL;
  char *result = NULL;
  const char *sql =
      "SELECT CASE type WHEN 'object' THEN value WHEN 'array' THEN value WHEN "
      "'true' THEN 'true' WHEN 'false' THEN 'false' WHEN 'null' THEN 'null' "
      "ELSE json_quote(value) END FROM json_each(?1) WHERE key=?2";
  if (sqlite3_open(":memory:", &db) != SQLITE_OK)
    goto done;
  if (sqlite3_prepare_v2(db, sql, -1, &s, NULL) != SQLITE_OK)
    goto done;
  sqlite3_bind_text(s, 1, raw, -1, SQLITE_TRANSIENT);
  if (indexed)
    sqlite3_bind_int(s, 2, index);
  else
    sqlite3_bind_text(s, 2, key, -1, SQLITE_TRANSIENT);
  if (sqlite3_step(s) == SQLITE_ROW) {
    const char *p = (const char *)sqlite3_column_text(s, 0);
    int n = sqlite3_column_bytes(s, 0);
    if (p && (int)strlen(p) == n)
      result = strdup(p);
  }
done:
  sqlite3_finalize(s);
  if (db)
    sqlite3_close(db);
  return result;
}
static inline char *hp_field(const char *raw, const char *key) {
  return hp_get(raw, key, 0, 0);
}
static inline char *hp_item(const char *raw, int index) {
  return hp_get(raw, NULL, index, 1);
}
static inline int hp_text(const char *raw, const char *key, char *out,
                          size_t cap) {
  char *value = key ? hp_field(raw, key) : strdup(raw);
  sqlite3 *db = NULL;
  sqlite3_stmt *s = NULL;
  int ok = 0;
  if (!value || !cap || sqlite3_open(":memory:", &db) != SQLITE_OK)
    goto done;
  if (sqlite3_prepare_v2(db, "SELECT json_type(?1),json_extract(?1,'$')", -1,
                         &s, NULL) != SQLITE_OK)
    goto done;
  sqlite3_bind_text(s, 1, value, -1, SQLITE_TRANSIENT);
  if (sqlite3_step(s) != SQLITE_ROW)
    goto done;
  const char *type = (const char *)sqlite3_column_text(s, 0),
             *p = (const char *)sqlite3_column_text(s, 1);
  int n = sqlite3_column_bytes(s, 1);
  if (!type || strcmp(type, "text") || !p || n < 1 || (size_t)n >= cap ||
      (int)strlen(p) != n)
    goto done;
  memcpy(out, p, (size_t)n + 1);
  ok = 1;
done:
  free(value);
  sqlite3_finalize(s);
  if (db)
    sqlite3_close(db);
  return ok;
}
static inline int hp_argument(const char *raw, char *out, size_t cap) {
  if (!raw || !out || !cap)
    return 0;
  if (!strcmp(raw, "\"\"")) {
    out[0] = 0;
    return 1;
  }
  return hp_text(raw, NULL, out, cap);
}
static inline int hp_count(const char *raw) {
  sqlite3 *db = NULL;
  sqlite3_stmt *s = NULL;
  int count = -1;
  if (!raw || sqlite3_open(":memory:", &db) != SQLITE_OK)
    goto done;
  if (sqlite3_prepare_v2(db,
                         "SELECT CASE WHEN json_type(?1)='array' THEN "
                         "json_array_length(?1) ELSE -1 END",
                         -1, &s, NULL) != SQLITE_OK)
    goto done;
  sqlite3_bind_text(s, 1, raw, -1, SQLITE_TRANSIENT);
  if (sqlite3_step(s) == SQLITE_ROW)
    count = sqlite3_column_int(s, 0);
done:
  sqlite3_finalize(s);
  if (db)
    sqlite3_close(db);
  return count;
}
static inline int hp_shape(const char *raw, const char *const *keys,
                           size_t count) {
  sqlite3 *db = NULL;
  sqlite3_stmt *s = NULL;
  int ok = 0;
  size_t found = 0;
  if (!raw || sqlite3_open(":memory:", &db) != SQLITE_OK)
    goto done;
  if (sqlite3_prepare_v2(db, "SELECT key FROM json_each(?1)", -1, &s, NULL) !=
      SQLITE_OK)
    goto done;
  sqlite3_bind_text(s, 1, raw, -1, SQLITE_TRANSIENT);
  while (sqlite3_step(s) == SQLITE_ROW) {
    const char *key = (const char *)sqlite3_column_text(s, 0);
    size_t i;
    if (!key || sqlite3_column_bytes(s, 0) != (int)strlen(key))
      goto done;
    for (i = 0; i < count; ++i)
      if (!strcmp(key, keys[i]))
        break;
    if (i == count)
      goto done;
    ++found;
  }
  ok = found == count;
done:
  sqlite3_finalize(s);
  if (db)
    sqlite3_close(db);
  return ok;
}
static inline int hp_integer(const char *raw, const char *key, int min, int max,
                             int *out) {
  char *value = hp_field(raw, key), *end = NULL;
  long n;
  int ok = 0;
  if (!value || !*value)
    goto done;
  errno = 0;
  n = strtol(value, &end, 10);
  if (errno || !*value || *end || n < min || n > max ||
      (*value == '0' && value[1]))
    goto done;
  *out = (int)n;
  ok = 1;
done:
  free(value);
  return ok;
}
static inline int hp_relative(const char *p) {
  if (!p || !*p || *p == '/' || strlen(p) > 2048 || strchr(p, '\\'))
    return 0;
  const char *s = p;
  for (const char *q = p;; ++q) {
    if ((unsigned char)*q < 32 && *q)
      return 0;
    if (*q == '/' || !*q) {
      size_t n = (size_t)(q - s);
      if (!n || (n == 1 && *s == '.') || (n == 2 && !strncmp(s, "..", 2)) ||
          (n == 4 && !strncmp(s, ".git", 4)))
        return 0;
      if (!*q)
        break;
      s = q + 1;
    }
  }
  return 1;
}
static inline int hp_id(const char *p) {
  if (!p || !*p || strlen(p) > 96 || !isalnum((unsigned char)*p))
    return 0;
  for (; *p; ++p)
    if (!isalnum((unsigned char)*p) && !strchr("._-", *p))
      return 0;
  return 1;
}
static inline int hp_digest(const char *p) {
  if (!p || strncmp(p, "sha256:", 7) || strlen(p) != 71)
    return 0;
  for (p += 7; *p; ++p)
    if (!strchr("0123456789abcdef", *p))
      return 0;
  return 1;
}
static inline int hp_oid(const char *p) {
  if (!p || (strlen(p) != 40 && strlen(p) != 64))
    return 0;
  for (; *p; ++p)
    if (!strchr("0123456789abcdef", *p))
      return 0;
  return 1;
}
static inline void hp_quote(FILE *f, const char *p) {
  fputc('"', f);
  for (; *p; ++p) {
    unsigned char c = (unsigned char)*p;
    if (c == '"' || c == '\\') {
      fputc('\\', f);
      fputc(c, f);
    } else if (c < 32)
      fprintf(f, "\\u%04x", c);
    else
      fputc(c, f);
  }
  fputc('"', f);
}
static inline int hp_open_dir(int anchor, const char *relative, int create) {
  if (!hp_relative(relative))
    return -1;
  char copy[2049];
  strcpy(copy, relative);
  int fd = dup(anchor);
  char *save = NULL;
  if (fd < 0)
    return -1;
  for (char *part = strtok_r(copy, "/", &save); part;
       part = strtok_r(NULL, "/", &save)) {
    if (create && mkdirat(fd, part, 0700) && errno != EEXIST) {
      close(fd);
      return -1;
    }
    int next = openat(fd, part,
                      ((save && *save) ? O_PATH : O_RDONLY) | O_DIRECTORY |
                          O_NOFOLLOW | O_CLOEXEC);
    close(fd);
    fd = next;
    if (fd < 0)
      return -1;
  }
  return fd;
}
static inline int hp_root(const char *name) {
  const char *root = getenv(name), *host = getenv("HF_EXECUTION_HOST_CLASS");
  if (!host || strcmp(host, "remote") || !root || root[0] != '/' ||
      root[1] == '\0' || !hp_relative(root + 1))
    return -1;
  int fd = open("/", O_RDONLY | O_DIRECTORY | O_CLOEXEC);
  if (fd < 0)
    return -1;
  int result = hp_open_dir(fd, root + 1, 0);
  close(fd);
  return result;
}
static inline int hp_hash_file(int root, const char *relative, char out[72]) {
  if (!hp_relative(relative))
    return 0;
  char copy[2049];
  strcpy(copy, relative);
  char *name = copy, *slash = strrchr(copy, '/');
  int parent = dup(root), fd = -1;
  EVP_MD_CTX *ctx = NULL;
  int ok = 0;
  struct stat before, after, named;
  if (parent < 0)
    return 0;
  if (slash) {
    *slash = 0;
    name = slash + 1;
    int nested = hp_open_dir(parent, copy, 0);
    close(parent);
    parent = nested;
    if (parent < 0)
      return 0;
  }
  fd = openat(parent, name, O_RDONLY | O_NOFOLLOW | O_CLOEXEC);
  if (fd < 0 || fstat(fd, &before) || !S_ISREG(before.st_mode) ||
      before.st_nlink != 1)
    goto done;
  ctx = EVP_MD_CTX_new();
  if (!ctx || EVP_DigestInit_ex(ctx, EVP_sha256(), NULL) != 1)
    goto done;
  unsigned char buffer[65536];
  ssize_t count;
  while ((count = read(fd, buffer, sizeof buffer)) != 0) {
    if (hp_cancelled)
      goto done;
    if (count < 0) {
      if (errno == EINTR)
        continue;
      goto done;
    }
    if (EVP_DigestUpdate(ctx, buffer, (size_t)count) != 1)
      goto done;
  }
  if (fstat(fd, &after) || fstatat(parent, name, &named, AT_SYMLINK_NOFOLLOW) ||
      before.st_dev != after.st_dev || before.st_ino != after.st_ino ||
      before.st_size != after.st_size ||
      before.st_mtim.tv_sec != after.st_mtim.tv_sec ||
      before.st_mtim.tv_nsec != after.st_mtim.tv_nsec ||
      before.st_ctim.tv_sec != after.st_ctim.tv_sec ||
      before.st_ctim.tv_nsec != after.st_ctim.tv_nsec ||
      before.st_dev != named.st_dev || before.st_ino != named.st_ino ||
      before.st_size != named.st_size ||
      before.st_mtim.tv_sec != named.st_mtim.tv_sec ||
      before.st_mtim.tv_nsec != named.st_mtim.tv_nsec ||
      before.st_ctim.tv_sec != named.st_ctim.tv_sec ||
      before.st_ctim.tv_nsec != named.st_ctim.tv_nsec)
    goto done;
  unsigned char bytes[EVP_MAX_MD_SIZE];
  unsigned length = 0;
  if (EVP_DigestFinal_ex(ctx, bytes, &length) != 1 || length != 32)
    goto done;
  memcpy(out, "sha256:", 7);
  for (unsigned i = 0; i < 32; i++)
    sprintf(out + 7 + i * 2, "%02x", bytes[i]);
  out[71] = 0;
  ok = 1;
done:
  EVP_MD_CTX_free(ctx);
  if (fd >= 0)
    close(fd);
  close(parent);
  return ok;
}
static inline long long hp_millis(void) {
  struct timespec ts;
  if (clock_gettime(CLOCK_MONOTONIC, &ts))
    return -1;
  return (long long)ts.tv_sec * 1000 + ts.tv_nsec / 1000000;
}
/* No shell interpolation, inherited authentication homes, or repository hooks.
 * Each child owns a process group; timeouts terminate the entire group. */
static inline int hp_spawn_env(const char *cwd, char *const argv[],
                               const char *log, int seconds,
                               char *const extra[]) {
  if (hp_cancelled)
    return 125;
  if (seconds < 1 || seconds > 3600)
    return -1;
  char canonical[PATH_MAX];
  if (!realpath(cwd, canonical))
    return -1;
  int fd =
      open(log, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0600);
  if (fd < 0)
    return -1;
  int channel[2];
  if (pipe2(channel, O_CLOEXEC | O_NONBLOCK)) {
    close(fd);
    return -1;
  }
  pid_t pid = fork();
  if (pid < 0) {
    close(channel[0]);
    close(channel[1]);
    close(fd);
    return -1;
  }
  if (pid == 0) {
    setpgid(0, 0);
    close(channel[0]);
    int flags = fcntl(channel[1], F_GETFL);
    if (flags < 0 || fcntl(channel[1], F_SETFL, flags & ~O_NONBLOCK))
      _exit(126);
    if (chdir(canonical) || dup2(channel[1], STDOUT_FILENO) < 0 ||
        dup2(channel[1], STDERR_FILENO) < 0)
      _exit(126);
    close(channel[1]);
    close(fd);
    int nullfd = open("/dev/null", O_RDONLY);
    if (nullfd >= 0) {
      dup2(nullfd, STDIN_FILENO);
      close(nullfd);
    }
    char home[PATH_MAX], tmp[PATH_MAX], diagnostics[PATH_MAX];
    if (strlen(log) >= sizeof diagnostics)
      _exit(126);
    strcpy(diagnostics, log);
    char *last = strrchr(diagnostics, '/');
    if (!last)
      _exit(126);
    *last = 0;
    const char *bound_home = getenv("HF_JOB_HOME"),
               *bound_tmp = getenv("HF_JOB_TMPDIR");
    if (snprintf(home, sizeof home, "%s", bound_home ? bound_home : "") >=
            (int)sizeof home ||
        snprintf(tmp, sizeof tmp, "%s", bound_tmp ? bound_tmp : "") >=
            (int)sizeof tmp)
      _exit(126);
    if (!bound_home && snprintf(home, sizeof home, "%s/.hf-home",
                                diagnostics) >= (int)sizeof home)
      _exit(126);
    if (!bound_tmp &&
        snprintf(tmp, sizeof tmp, "%s/.hf-tmp", diagnostics) >= (int)sizeof tmp)
      _exit(126);
    if (home[0] != '/' || tmp[0] != '/')
      _exit(126);
    mkdir(home, 0700);
    mkdir(tmp, 0700);
    clearenv();
    setenv("PATH", "/usr/local/bin:/usr/bin:/bin", 1);
    setenv("HOME", home, 1);
    setenv("TMPDIR", tmp, 1);
    setenv("GIT_CONFIG_NOSYSTEM", "1", 1);
    setenv("GIT_CONFIG_GLOBAL", "/dev/null", 1);
    setenv("GIT_OPTIONAL_LOCKS", "0", 1);
    setenv("GIT_TERMINAL_PROMPT", "0", 1);
    setenv("GIT_LFS_SKIP_SMUDGE", "1", 1);
    if (extra)
      for (size_t i = 0; extra[i]; i++) {
        if (putenv(extra[i]))
          _exit(126);
      }
    execvp(argv[0], argv);
    _exit(127);
  }
  close(channel[1]);
  setpgid(pid, pid);
  long long deadline = hp_millis() + (long long)seconds * 1000,
            drain_deadline = 0;
  size_t written = 0;
  const size_t log_limit = 16 * 1024 * 1024;
  int status = 0, finished = 0, reaped = 0, identity_lost = 0, failure = 0,
      eof = 0;
  for (;;) {
    unsigned char buffer[65536];
    for (;;) {
      ssize_t n = read(channel[0], buffer, sizeof buffer);
      if (n == 0) {
        eof = 1;
        break;
      }
      if (n < 0) {
        if (errno == EINTR)
          continue;
        if (errno != EAGAIN && errno != EWOULDBLOCK)
          failure = 126;
        break;
      }
      if ((size_t)n > log_limit - written) {
        failure = 126;
        break;
      }
      size_t offset = 0;
      while (offset < (size_t)n) {
        ssize_t count = write(fd, buffer + offset, (size_t)n - offset);
        if (count < 0 && errno == EINTR)
          continue;
        if (count <= 0) {
          failure = 126;
          break;
        }
        offset += (size_t)count;
      }
      if (failure)
        break;
      written += (size_t)n;
    }
    if (!finished) {
      siginfo_t observed;
      memset(&observed, 0, sizeof observed);
      int waited =
          waitid(P_PID, (id_t)pid, &observed, WEXITED | WNOHANG | WNOWAIT);
      if (waited == 0 && observed.si_pid == pid) {
        finished = 1;
        /* Keep the exited leader unreaped until every group signal is complete.
         */
        kill(-pid, SIGKILL);
        drain_deadline = hp_millis() + 200;
      } else if (waited < 0 && errno != EINTR) {
        failure = 126;
        identity_lost = 1;
        finished = 1;
      }
    }
    if (hp_cancelled)
      failure = 125;
    if (!finished && hp_millis() > deadline)
      failure = 124;
    if (failure) {
      if (!identity_lost)
        kill(-pid, SIGKILL);
      if (!identity_lost && !reaped) {
        pid_t waited;
        do {
          waited = waitpid(pid, &status, 0);
        } while (waited < 0 && errno == EINTR);
        reaped = waited == pid;
        if (!reaped)
          failure = 126;
      }
      break;
    }
    if (finished && (eof || hp_millis() > drain_deadline))
      break;
    struct pollfd ready = {channel[0], POLLIN | POLLHUP, 0};
    if (poll(&ready, 1, 10) < 0 && errno != EINTR) {
      failure = 126;
      if (!identity_lost)
        kill(-pid, SIGKILL);
      if (!identity_lost && !reaped) {
        pid_t waited;
        do {
          waited = waitpid(pid, &status, 0);
        } while (waited < 0 && errno == EINTR);
        reaped = waited == pid;
        if (!reaped)
          failure = 126;
      }
      break;
    }
  }
  if (!identity_lost && !reaped) {
    pid_t waited;
    do {
      waited = waitpid(pid, &status, 0);
    } while (waited < 0 && errno == EINTR);
    if (waited != pid)
      failure = 126;
  }
  close(channel[0]);
  if (fsync(fd))
    failure = 126;
  close(fd);
  if (failure)
    return failure;
  return WIFEXITED(status) ? WEXITSTATUS(status)
                           : 128 + (WIFSIGNALED(status) ? WTERMSIG(status) : 0);
}
static inline int hp_spawn(const char *cwd, char *const argv[], const char *log,
                           int seconds) {
  return hp_spawn_env(cwd, argv, log, seconds, NULL);
}
#endif
