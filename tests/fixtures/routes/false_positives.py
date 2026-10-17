# Shapes lifted from runtime/supervisory_host.py, scripts/format_changelog.py
# and spec/hyperfide/tools/validate_pack.py: dict lookups, not routes.
def summarize(r, recorded, item, number, author, committer):
    if not r.get('output_complete',False):r['output_truncated']=True
    leader = recorded.get("leader", author or committer or "author-unrecorded")
    category = item.get('category', f'local-policy-{number}')
    cached = self.cache.get('/tmp/cache', fallback)
    app_settings = settings.get("app", default)
    return leader, category, cached, app_settings

app.get('key', fallback)
router.post('relative', handler)

@custom.get('not-a-path')
def not_a_route(): pass
