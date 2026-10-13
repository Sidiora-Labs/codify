#!/usr/bin/env python3
"""Deterministic scale fixture for the Codify index (codify-v15 req 3.6).

    tests/scale/gen.py OUT [--files N] [--lines L] [--seed S]

Writes a repository of N files totalling about L lines under OUT, in C, Go,
Python, TypeScript and Rust, spread over module directories under forty
top-level groups so the parallel walk has directories to divide. Every
source file defines functions, imports a few files of its own language
elsewhere in the tree and calls what they define, and carries doc comments
that name a symbol of another file, so the parser, the import resolver, the
ref resolver, the soft edges, grep and files all have real work. The same
arguments always produce the same bytes: the only randomness is a seeded LCG.

Each source file carries one string literal unique to it ("scale_marker_<n>;"),
which is what a literal grep is measured with: its candidates must be a
handful of files, never the tree.
"""
import argparse
import os
import sys

LANGS = ["c", "go", "py", "ts", "rs"]
EXT = {"c": ".c", "go": ".go", "py": ".py", "ts": ".ts", "rs": ".rs"}
PER_MOD = 25


class Lcg:
    def __init__(self, seed):
        self.s = seed & 0x7FFFFFFF

    def next(self):
        self.s = (self.s * 1103515245 + 12345) & 0x7FFFFFFF
        return self.s

    def below(self, n):
        return self.next() % n if n > 0 else 0


def plan(nfiles):
    """[(index, lang, module, stem)]; a C source counts twice (.c and .h),
    and go.mod at the root is the last file."""
    out = []
    i = 0
    n = 1
    while n < nfiles:
        lang = LANGS[i % len(LANGS)]
        if lang == "c" and n + 2 > nfiles:
            lang = "py"
        out.append((i, lang, i // PER_MOD, "f%05d" % i))
        n += 2 if lang == "c" else 1
        i += 1
    return out


def mdir(mod):
    return "g%02d/m%04d" % (mod % 40, mod)


def fname(lang, i, k):
    return ("Fn_%d_%d" if lang == "go" else "fn_%d_%d") % (i, k)


def rel_ts(here, t):
    a = here.split("/")
    b = mdir(t[2]).split("/")
    c = 0
    while c < len(a) and c < len(b) and a[c] == b[c]:
        c += 1
    up = [".."] * (len(a) - c) or ["."]
    return "/".join(up + b[c:] + [t[3]])


def render(lang, i, mod, stem, peers, rng, per_file, nfuncs):
    targets = []
    for _ in range(3):
        t = peers[rng.below(len(peers))]
        if t[0] != i and t not in targets:
            targets.append(t)
    here = mdir(mod)
    cite = fname(lang, targets[0][0], 0) if targets else fname(lang, i, 0)
    out = []
    if lang == "c":
        out.append("/* %s.c: module %d, file %d; see %s */" % (stem, mod, i, cite))
        out.append("#include <stdio.h>")
        out.append('#include "%s.h"' % stem)
        for t in targets:
            out.append('#include "../../%s/%s.h"' % (mdir(t[2]), t[3]))
    elif lang == "go":
        out.append("// Package m%04d, file %d; see %s." % (mod, i, cite))
        out.append("package m%04d" % mod)
        imps = sorted({t[2] for t in targets if t[2] != mod})
        if imps:
            out.append("")
            out.append("import (")
            for m in imps:
                out.append('\t"scale/%s"' % mdir(m))
            out.append(")")
    elif lang == "py":
        out.append('"""%s: module %d, file %d; see %s."""' % (stem, mod, i, cite))
        for t in targets:
            out.append("from %s.%s import %s" % (mdir(t[2]).replace("/", "."), t[3],
                                                fname(lang, t[0], 0)))
    elif lang == "ts":
        out.append("// %s: module %d, file %d; see %s." % (stem, mod, i, cite))
        for t in targets:
            out.append('import { %s } from "%s";' % (fname(lang, t[0], 0), rel_ts(here, t)))
    elif lang == "rs":
        out.append("//! %s: module %d, file %d; see %s." % (stem, mod, i, cite))
        for t in targets:
            out.append("use crate::%s::%s::%s;" % (mdir(t[2]).replace("/", "::"), t[3],
                                                  fname(lang, t[0], 0)))
    out.append("")
    # the line budget left after the header, spread over the functions
    body = max(2, (per_file - len(out)) // nfuncs - 7)
    for k in range(nfuncs):
        if k == 0:
            callees = []
            for t in targets:
                f = fname(lang, t[0], 0)
                callees.append("m%04d.%s" % (t[2], f) if lang == "go" and t[2] != mod else f)
        else:
            callees = [fname(lang, i, k - 1)]
        name = fname(lang, i, k)
        doc = "%s computes part %d of file %d and hands it to %s." % (
            name, k, i, callees[0] if callees else "nobody")
        stmts = []
        for j in range(body):
            if j < len(callees):
                stmts.append(("call", callees[j]))
            elif rng.below(6) == 0:
                stmts.append(("cmt", "step %d of %s folds the running total" % (j, name)))
            else:
                stmts.append(("acc", j * 7 + rng.below(97)))
        marker = "scale_marker_%d;" % i
        if lang == "c":
            out += ["/* %s */" % doc, "long %s(long x) {" % name, "    long acc = x;"]
            for kind, v in stmts:
                out.append({"call": "    acc += %s(acc);", "cmt": "    /* %s */",
                            "acc": "    acc = acc * 31 + %s;"}[kind] % v)
            if k == 0:
                out.append('    if (acc == 0) puts("%s");' % marker)
            out += ["    return acc;", "}", ""]
        elif lang == "go":
            out += ["// %s" % doc, "func %s(x int64) int64 {" % name, "\tacc := x"]
            for kind, v in stmts:
                out.append({"call": "\tacc += %s(acc)", "cmt": "\t// %s",
                            "acc": "\tacc = acc*31 + %s"}[kind] % v)
            if k == 0:
                out += ["\tif acc == 0 {", '\t\tprintln("%s")' % marker, "\t}"]
            out += ["\treturn acc", "}", ""]
        elif lang == "py":
            out += ["def %s(x):" % name, '    """%s"""' % doc, "    acc = x"]
            for kind, v in stmts:
                out.append({"call": "    acc += %s(acc)", "cmt": "    # %s",
                            "acc": "    acc = acc * 31 + %s"}[kind] % v)
            if k == 0:
                out += ["    if acc == 0:", '        print("%s")' % marker]
            out += ["    return acc", "", ""]
        elif lang == "ts":
            out += ["/** %s */" % doc, "export function %s(x: number): number {" % name,
                    "  let acc = x;"]
            for kind, v in stmts:
                out.append({"call": "  acc += %s(acc);", "cmt": "  // %s",
                            "acc": "  acc = acc * 31 + %s;"}[kind] % v)
            if k == 0:
                out.append('  if (acc === 0) console.log("%s");' % marker)
            out += ["  return acc;", "}", ""]
        elif lang == "rs":
            out += ["/// %s" % doc, "pub fn %s(x: i64) -> i64 {" % name,
                    "    let mut acc = x;"]
            for kind, v in stmts:
                out.append({"call": "    acc += %s(acc);", "cmt": "    // %s",
                            "acc": "    acc = acc.wrapping_mul(31) + %s;"}[kind] % v)
            if k == 0:
                out.append('    if acc == 0 { println!("%s"); }' % marker)
            out += ["    acc", "}", ""]
    return "\n".join(out) + "\n"


def header(i, stem, nfuncs):
    g = "SCALE_%s_H" % stem.upper()
    out = ["/* %s.h: the functions of %s.c */" % (stem, stem), "#ifndef " + g,
           "#define " + g, ""]
    out += ["long %s(long x);" % fname("c", i, k) for k in range(nfuncs)]
    out += ["", "#endif", ""]
    return "\n".join(out)


def main():
    ap = argparse.ArgumentParser(description="deterministic scale fixture for cg")
    ap.add_argument("out")
    ap.add_argument("--files", type=int, default=20000)
    ap.add_argument("--lines", type=int, default=2000000)
    ap.add_argument("--seed", type=int, default=15)
    a = ap.parse_args()
    if a.files < 10:
        sys.exit("gen.py: --files must be at least 10")
    files = plan(a.files)
    by_lang = {l: [f for f in files if f[1] == l] for l in LANGS}
    nsrc = len(files)
    per_file = max(24, a.lines // max(1, nsrc))
    nfuncs = max(2, per_file // 30)
    rng = Lcg(a.seed)
    nfiles = nlines = nbytes = 0
    made = set()
    for (i, lang, mod, stem) in files:
        d = os.path.join(a.out, mdir(mod))
        if d not in made:
            os.makedirs(d, exist_ok=True)
            made.add(d)
        outs = [(stem + EXT[lang], render(lang, i, mod, stem, by_lang[lang], rng,
                                          per_file, nfuncs))]
        if lang == "c":
            outs.append((stem + ".h", header(i, stem, nfuncs)))
        for name, t in outs:
            data = t.encode()
            with open(os.path.join(d, name), "wb") as f:
                f.write(data)
            nfiles += 1
            nlines += t.count("\n")
            nbytes += len(data)
    gomod = "module scale\n\ngo 1.21\n"
    with open(os.path.join(a.out, "go.mod"), "w") as f:
        f.write(gomod)
    nfiles += 1
    nlines += 3
    nbytes += len(gomod)
    print("%d files, %d lines, %d bytes" % (nfiles, nlines, nbytes))


if __name__ == "__main__":
    main()
