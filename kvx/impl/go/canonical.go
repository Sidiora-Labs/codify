// Copyright © 2026 Sidiora Labs. SPDX-License-Identifier: MIT

package kvx

import (
	"crypto/sha256"
	"encoding/hex"
	"strings"
)

// Canonical renders the document in canonical form: comments stripped,
// exactly one "key = value" per line, one blank line between sections,
// sections and keys in original file order, raw value tokens preserved
// (no unquoting, no interpolation). Parsing the output yields an
// equivalent document, and canonical rendering is a fixed point:
// Canonical(Parse(Canonical(d))) == Canonical(d).
func (d *Doc) Canonical() string {
	var b strings.Builder
	for i, sec := range d.order {
		if i > 0 {
			b.WriteString("\n")
		}
		if sec != "" {
			b.WriteString("[")
			b.WriteString(sec)
			b.WriteString("]\n")
		}
		for _, k := range d.keyOrder[sec] {
			b.WriteString(k)
			b.WriteString(" = ")
			b.WriteString(d.sections[sec][k])
			b.WriteString("\n")
		}
	}
	return b.String()
}

// Hash returns the hex-encoded SHA-256 of the canonical form. Because
// canonicalisation strips comments and normalises whitespace, the hash
// is stable across cosmetic edits.
func (d *Doc) Hash() string {
	sum := sha256.Sum256([]byte(d.Canonical()))
	return hex.EncodeToString(sum[:])
}
