// Copyright © 2026 Sidiora Labs. SPDX-License-Identifier: MIT

package kvx

import (
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

const sample = `# leading comment
[meta]
name    = "Sample Doc"
version = 3
active  = true # trailing comment
tags    = ["a", "b, with comma", c]
home    = ${KVX_TEST_HOME}

[req.1]
title = "first"

[req.2]
title = "second # not a comment"

[req.10]
title = "tenth"
`

func mustParse(t *testing.T, src string) *Doc {
	t.Helper()
	d, err := Parse(strings.NewReader(src), "test.kvx")
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	return d
}

func TestParseBasics(t *testing.T) {
	os.Setenv("KVX_TEST_HOME", "/home/kvx")
	d := mustParse(t, sample)

	if got := d.Str("meta", "name"); got != "Sample Doc" {
		t.Errorf("Str name = %q", got)
	}
	if got := d.UintOr("meta", "version", 0); got != 3 {
		t.Errorf("UintOr version = %d", got)
	}
	if !d.Bool("meta", "active", false) {
		t.Error("Bool active = false")
	}
	if got := d.Str("meta", "home"); got != "/home/kvx" {
		t.Errorf("env interpolation = %q", got)
	}
	want := []string{"a", "b, with comma", "c"}
	if got := d.List("meta", "tags"); !reflect.DeepEqual(got, want) {
		t.Errorf("List tags = %v, want %v", got, want)
	}
	if got := d.Str("req.2", "title"); got != "second # not a comment" {
		t.Errorf("quoted hash = %q", got)
	}
}

func TestOrderPreserved(t *testing.T) {
	d := mustParse(t, sample)
	wantSecs := []string{"meta", "req.1", "req.2", "req.10"}
	if got := d.Sections(); !reflect.DeepEqual(got, wantSecs) {
		t.Errorf("Sections = %v, want %v", got, wantSecs)
	}
	wantKeys := []string{"name", "version", "active", "tags", "home"}
	if got := d.Keys("meta"); !reflect.DeepEqual(got, wantKeys) {
		t.Errorf("Keys(meta) = %v, want %v", got, wantKeys)
	}
}

func TestSectionsWithPrefix(t *testing.T) {
	d := mustParse(t, sample)
	want := []string{"1", "2", "10"}
	if got := d.SectionsWithPrefix("req"); !reflect.DeepEqual(got, want) {
		t.Errorf("SectionsWithPrefix(req) = %v, want %v", got, want)
	}
}

func TestSortDottedIDs(t *testing.T) {
	ids := []string{"1.10", "2", "1.2", "1"}
	SortDottedIDs(ids)
	want := []string{"1", "1.2", "1.10", "2"}
	if !reflect.DeepEqual(ids, want) {
		t.Errorf("SortDottedIDs = %v, want %v", ids, want)
	}
}

func TestIsList(t *testing.T) {
	d := mustParse(t, sample)
	if !d.IsList("meta", "tags") {
		t.Error("IsList(tags) = false")
	}
	if d.IsList("meta", "name") {
		t.Error("IsList(name) = true")
	}
}

func TestDuplicateKeyLastWins(t *testing.T) {
	d := mustParse(t, "[s]\nk = 1\nk = 2\n")
	if got := d.Str("s", "k"); got != "2" {
		t.Errorf("duplicate key = %q, want 2", got)
	}
	if got := d.Keys("s"); !reflect.DeepEqual(got, []string{"k"}) {
		t.Errorf("Keys = %v, want [k]", got)
	}
}

func TestParseErrors(t *testing.T) {
	cases := []struct{ name, src string }{
		{"unterminated section", "[meta\nk = v\n"},
		{"missing equals", "[meta]\njust a bare line\n"},
		{"empty key", "[meta]\n= v\n"},
		{"invalid section name", "[bad name]\nk = v\n"},
	}
	for _, c := range cases {
		if _, err := Parse(strings.NewReader(c.src), c.name); err == nil {
			t.Errorf("%s: expected error, got nil", c.name)
		}
	}
}

func TestCanonicalFixedPoint(t *testing.T) {
	d := mustParse(t, sample)
	c1 := d.Canonical()
	d2 := mustParse(t, c1)
	if c2 := d2.Canonical(); c2 != c1 {
		t.Errorf("canonical not a fixed point:\n--- first ---\n%s\n--- second ---\n%s", c1, c2)
	}
	if d.Hash() != d2.Hash() {
		t.Error("hash differs across canonical round-trip")
	}
}

func TestConformanceCorpus(t *testing.T) {
	valid, _ := filepath.Glob("../../testdata/valid/*.kvx")
	if len(valid) == 0 {
		t.Skip("no conformance corpus present")
	}
	for _, p := range valid {
		t.Run("valid/"+filepath.Base(p), func(t *testing.T) {
			d, err := ParseFile(p)
			if err != nil {
				t.Fatalf("expected valid, got: %v", err)
			}
			c := d.Canonical()
			d2, err := Parse(strings.NewReader(c), p+"#canonical")
			if err != nil {
				t.Fatalf("canonical re-parse failed: %v", err)
			}
			if d2.Canonical() != c {
				t.Error("canonical not a fixed point")
			}
		})
	}
	invalid, _ := filepath.Glob("../../testdata/invalid/*.kvx")
	for _, p := range invalid {
		t.Run("invalid/"+filepath.Base(p), func(t *testing.T) {
			if _, err := ParseFile(p); err == nil {
				t.Error("expected parse error, got nil")
			}
		})
	}
}
