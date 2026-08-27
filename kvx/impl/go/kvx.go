// Copyright © 2026 Sidiora Labs. SPDX-License-Identifier: MIT

// Package kvx is the reference implementation of the KVX document format.
//
// KVX is an ordered, sectioned key/value document format:
//
//	# comment
//	[section]
//	key = value
//	quoted = "a string # not a comment"
//	list = ["a", "b", "c"]
//	env = ${HOME}
//
//	[dotted.sub.section]
//	n = 1
//
// The parser is zero-dependency and deterministic. It preserves the
// insertion ORDER of both sections and the keys within each section,
// so rendered output is byte-for-byte reproducible.
//
// Normative spec: spec/kvx-1.0.md in the KVX repository.
package kvx

import (
	"bufio"
	"fmt"
	"io"
	"os"
	"regexp"
	"strconv"
	"strings"
)

// Doc is a parsed .kvx file: an ordered, sectioned key/value document.
type Doc struct {
	order    []string            // section names in file order
	keyOrder map[string][]string // section -> keys in file order
	sections map[string]map[string]string
}

var (
	envRef     = regexp.MustCompile(`\$\{([A-Za-z_][A-Za-z0-9_]*)\}`)
	sectionRef = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_-]*(\.[A-Za-z0-9_-]+)*$`)
)

// NewDoc returns an empty document.
func NewDoc() *Doc {
	return &Doc{
		keyOrder: map[string][]string{},
		sections: map[string]map[string]string{},
	}
}

// ParseFile reads and parses a .kvx file. A missing file is an error.
func ParseFile(path string) (*Doc, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	return Parse(f, path)
}

// Parse parses a KVX document from r. The name is used in error messages.
func Parse(r io.Reader, name string) (*Doc, error) {
	doc := NewDoc()
	sc := bufio.NewScanner(r)
	sc.Buffer(make([]byte, 1024*1024), 1024*1024)
	section := ""
	lineNo := 0
	for sc.Scan() {
		lineNo++
		line := stripComment(strings.TrimSpace(sc.Text()))
		if line == "" {
			continue
		}
		if strings.HasPrefix(line, "[") {
			if !strings.HasSuffix(line, "]") {
				return nil, fmt.Errorf("%s line %d: unterminated section header %q", name, lineNo, line)
			}
			section = strings.TrimSpace(line[1 : len(line)-1])
			if !sectionRef.MatchString(section) {
				return nil, fmt.Errorf("%s line %d: invalid section name %q", name, lineNo, section)
			}
			doc.ensure(section)
			continue
		}
		key, val, ok := strings.Cut(line, "=")
		if !ok {
			return nil, fmt.Errorf("%s line %d: expected key = value, got %q", name, lineNo, line)
		}
		key = strings.TrimSpace(key)
		if key == "" {
			return nil, fmt.Errorf("%s line %d: empty key", name, lineNo)
		}
		doc.ensure(section)
		if _, seen := doc.sections[section][key]; !seen {
			doc.keyOrder[section] = append(doc.keyOrder[section], key)
		}
		doc.sections[section][key] = strings.TrimSpace(val)
	}
	if err := sc.Err(); err != nil {
		return nil, err
	}
	return doc, nil
}

func (d *Doc) ensure(section string) {
	if _, ok := d.sections[section]; !ok {
		d.sections[section] = map[string]string{}
		d.order = append(d.order, section)
	}
}

func stripComment(line string) string {
	inQuote := false
	for i := 0; i < len(line); i++ {
		switch line[i] {
		case '"':
			inQuote = !inQuote
		case '#':
			if !inQuote {
				return strings.TrimSpace(line[:i])
			}
		}
	}
	return line
}

// Has reports whether a section is present.
func (d *Doc) Has(section string) bool {
	_, ok := d.sections[section]
	return ok
}

// Str returns the interpolated string value of section.key, or "".
func (d *Doc) Str(section, key string) string {
	sec, ok := d.sections[section]
	if !ok {
		return ""
	}
	raw, ok := sec[key]
	if !ok {
		return ""
	}
	return interpolate(unquote(raw))
}

// Bool returns section.key as a bool (true|1|yes), or fallback.
func (d *Doc) Bool(section, key string, fallback bool) bool {
	v := strings.ToLower(d.Str(section, key))
	if v == "" {
		return fallback
	}
	return v == "true" || v == "1" || v == "yes"
}

// List returns a bracketed list value as interpolated strings. A scalar
// value is returned as a one-element list.
func (d *Doc) List(section, key string) []string {
	sec, ok := d.sections[section]
	if !ok {
		return nil
	}
	raw, ok := sec[key]
	if !ok {
		return nil
	}
	raw = strings.TrimSpace(raw)
	if !strings.HasPrefix(raw, "[") || !strings.HasSuffix(raw, "]") {
		if v := interpolate(unquote(raw)); v != "" {
			return []string{v}
		}
		return nil
	}
	inner := strings.TrimSpace(raw[1 : len(raw)-1])
	if inner == "" {
		return nil
	}
	var out []string
	for _, part := range splitList(inner) {
		if v := interpolate(unquote(strings.TrimSpace(part))); v != "" {
			out = append(out, v)
		}
	}
	return out
}

// Keys returns the keys of a section in file order.
func (d *Doc) Keys(section string) []string {
	return d.keyOrder[section]
}

// Raw returns the un-interpolated, un-unquoted token for section.key (so a
// caller can tell a list ("[...]") from a scalar). Empty when absent.
func (d *Doc) Raw(section, key string) string {
	if sec, ok := d.sections[section]; ok {
		return sec[key]
	}
	return ""
}

// IsList reports whether section.key holds a bracketed list token.
func (d *Doc) IsList(section, key string) bool {
	raw := strings.TrimSpace(d.Raw(section, key))
	return strings.HasPrefix(raw, "[") && strings.HasSuffix(raw, "]")
}

// OrderedKV returns the (key, interpolated-string) pairs of a section in file
// order, optionally filtered to keys with the given prefix.
func (d *Doc) OrderedKV(section, prefix string) [][2]string {
	var out [][2]string
	for _, k := range d.keyOrder[section] {
		if prefix != "" && !strings.HasPrefix(k, prefix) {
			continue
		}
		out = append(out, [2]string{k, interpolate(unquote(d.sections[section][k]))})
	}
	return out
}

// Sections returns section names in file order.
func (d *Doc) Sections() []string { return d.order }

// SectionsWithPrefix returns the sub-section names under "prefix." (e.g.
// "req.1" -> "1") in file order, for table-style groups.
func (d *Doc) SectionsWithPrefix(prefix string) []string {
	var out []string
	p := prefix + "."
	for _, s := range d.order {
		if strings.HasPrefix(s, p) {
			out = append(out, strings.TrimPrefix(s, p))
		}
	}
	return out
}

// UintOr parses section.key as uint64, returning fallback when absent/invalid.
func (d *Doc) UintOr(section, key string, fallback uint64) uint64 {
	v := d.Str(section, key)
	if v == "" {
		return fallback
	}
	n, err := strconv.ParseUint(v, 10, 64)
	if err != nil {
		return fallback
	}
	return n
}

func splitList(s string) []string {
	var parts []string
	inQuote := false
	start := 0
	for i := 0; i < len(s); i++ {
		switch s[i] {
		case '"':
			inQuote = !inQuote
		case ',':
			if !inQuote {
				parts = append(parts, s[start:i])
				start = i + 1
			}
		}
	}
	return append(parts, s[start:])
}

func unquote(s string) string {
	s = strings.TrimSpace(s)
	if len(s) >= 2 && s[0] == '"' && s[len(s)-1] == '"' {
		return s[1 : len(s)-1]
	}
	return s
}

func interpolate(s string) string {
	if !strings.Contains(s, "${") {
		return s
	}
	return envRef.ReplaceAllStringFunc(s, func(m string) string {
		return os.Getenv(m[2 : len(m)-1])
	})
}

// SortDottedIDs sorts ids like "1","1.10","1.2","2" by numeric segments.
func SortDottedIDs(ids []string) {
	less := func(a, b string) bool {
		as, bs := strings.Split(a, "."), strings.Split(b, ".")
		for i := 0; i < len(as) && i < len(bs); i++ {
			ai, aerr := strconv.Atoi(as[i])
			bi, berr := strconv.Atoi(bs[i])
			if aerr == nil && berr == nil {
				if ai != bi {
					return ai < bi
				}
				continue
			}
			if as[i] != bs[i] {
				return as[i] < bs[i]
			}
		}
		return len(as) < len(bs)
	}
	for i := 1; i < len(ids); i++ {
		for j := i; j > 0 && less(ids[j], ids[j-1]); j-- {
			ids[j], ids[j-1] = ids[j-1], ids[j]
		}
	}
}
