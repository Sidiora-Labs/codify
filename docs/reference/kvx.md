# Source reference: KVX reference implementation

This part of the [source reference](../SOURCE-REFERENCE.md) lists the indexed declarations of the Go reference implementation of the KVX document format under `kvx/impl/go/`; there is no `vendor/kvx/` directory in this revision: 23 declarations in 2 files at revision `a2a367f9` of the Hyperfide 2.0 development tree (`hyperfide version` 2.0.0-dev, not a release). Method, column meanings and caveats are described in the entry point; source links resolve from this directory and line numbers refer to revision `a2a367f9`.

## kvx/impl/go/canonical.go

[Open source](../../kvx/impl/go/canonical.go)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `Canonical` | method | 17 | <code>func (d &#42;Doc) Canonical() string {</code> |
| `Hash` | method | 41 | <code>func (d &#42;Doc) Hash() string {</code> |

## kvx/impl/go/kvx.go

[Open source](../../kvx/impl/go/kvx.go)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `Doc` | struct | 35 | <code>type Doc struct {</code> |
| `NewDoc` | function | 47 | <code>func NewDoc() &#42;Doc {</code> |
| `ParseFile` | function | 55 | <code>func ParseFile(path string) (&#42;Doc, error) {</code> |
| `Parse` | function | 65 | <code>func Parse(r io.Reader, name string) (&#42;Doc, error) {</code> |
| `ensure` | method | 108 | <code>func (d &#42;Doc) ensure(section string) {</code> |
| `stripComment` | function | 115 | <code>func stripComment(line string) string {</code> |
| `Has` | method | 131 | <code>func (d &#42;Doc) Has(section string) bool {</code> |
| `Str` | method | 137 | <code>func (d &#42;Doc) Str(section, key string) string {</code> |
| `Bool` | method | 150 | <code>func (d &#42;Doc) Bool(section, key string, fallback bool) bool {</code> |
| `List` | method | 160 | <code>func (d &#42;Doc) List(section, key string) &#91;&#93;string {</code> |
| `Keys` | method | 190 | <code>func (d &#42;Doc) Keys(section string) &#91;&#93;string {</code> |
| `Raw` | method | 196 | <code>func (d &#42;Doc) Raw(section, key string) string {</code> |
| `IsList` | method | 204 | <code>func (d &#42;Doc) IsList(section, key string) bool {</code> |
| `OrderedKV` | method | 211 | <code>func (d &#42;Doc) OrderedKV(section, prefix string) &#91;&#93;&#91;2&#93;string {</code> |
| `Sections` | method | 223 | <code>func (d &#42;Doc) Sections() &#91;&#93;string { return d.order }</code> |
| `SectionsWithPrefix` | method | 227 | <code>func (d &#42;Doc) SectionsWithPrefix(prefix string) &#91;&#93;string {</code> |
| `UintOr` | method | 239 | <code>func (d &#42;Doc) UintOr(section, key string, fallback uint64) uint64 {</code> |
| `splitList` | function | 251 | <code>func splitList(s string) &#91;&#93;string {</code> |
| `unquote` | function | 269 | <code>func unquote(s string) string {</code> |
| `interpolate` | function | 277 | <code>func interpolate(s string) string {</code> |
| `SortDottedIDs` | function | 287 | <code>func SortDottedIDs(ids &#91;&#93;string) {</code> |
