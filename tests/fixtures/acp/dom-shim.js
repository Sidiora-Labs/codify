/* Enough DOM for the agent panel's inline script to run under node: element
 * creation, class lists, datasets, events, and the handful of selectors the
 * panel actually queries. No dependencies, by the same rule as the extension. */
'use strict';

function matches(el, sel) {
    /* supports "tag", ".cls", "[attr=\"v\"]" and simple concatenations */
    const parts = sel.match(/^([a-z][\w-]*)?((?:\.[\w-]+)*)((?:\[[^\]]+\])*)$/i);
    if (!parts) return false;
    if (parts[1] && el.tag !== parts[1]) return false;
    for (const c of (parts[2] || '').split('.').filter(Boolean)) {
        if (!el.classList.contains(c)) return false;
    }
    const attrs = (parts[3] || '').match(/\[[^\]]+\]/g) || [];
    for (const a of attrs) {
        const m = a.match(/\[([\w-]+)="?([^"\]]*)"?\]/);
        if (!m) return false;
        const key = m[1].replace(/^data-/, '').replace(/-(\w)/g, (_, c) => c.toUpperCase());
        const have = m[1].startsWith('data-') ? el.dataset[key] : el[m[1]];
        if (String(have) !== m[2]) return false;
    }
    return true;
}

class El {
    constructor(tag) {
        this.tag = tag;
        this.children = [];
        this.parent = null;
        this.dataset = {};
        this.style = {};
        this.attrs = {};
        this._text = '';
        this.listeners = {};
        this.scrollTop = 0; this.scrollHeight = 100; this.clientHeight = 100;
        const self = this;
        this.classList = {
            _s: new Set(),
            add(...c) { c.forEach((x) => this._s.add(x)); self._sync(); },
            remove(...c) { c.forEach((x) => this._s.delete(x)); self._sync(); },
            contains(c) { return this._s.has(c); },
            toggle(c, on) {
                const want = on === undefined ? !this._s.has(c) : !!on;
                if (want) this._s.add(c); else this._s.delete(c);
                self._sync();
            },
        };
    }
    _sync() { this.attrs.class = [...this.classList._s].join(' '); }
    /* ids are registered as they are assigned — the panel builds the welcome
     * block at runtime and later looks it up by id to clear it */
    set id(v) { this._id = v; doc._byId.set(v, this); }
    get id() { return this._id || ''; }
    set className(v) {
        this.classList._s = new Set(String(v).split(/\s+/).filter(Boolean));
        this._sync();
    }
    get className() { return [...this.classList._s].join(' '); }
    set textContent(v) { this.children = []; this._text = String(v); }
    get textContent() {
        return this._text + this.children.map((c) => c.textContent).join('');
    }
    get childElementCount() { return this.children.length; }
    appendChild(c) { c.parent = this; this.children.push(c); return c; }
    removeChild(c) {
        this.children = this.children.filter((x) => x !== c);
        return c;
    }
    remove() {
        if (this.parent) this.parent.removeChild(this);
        if (this._id && doc._byId.get(this._id) === this) doc._byId.delete(this._id);
    }
    addEventListener(ev, fn) {
        (this.listeners[ev] = this.listeners[ev] || []).push(fn);
    }
    dispatch(ev, arg) {
        (this.listeners[ev] || []).forEach((fn) => fn.call(this,
            Object.assign({ preventDefault() {}, target: this }, arg || {})));
    }
    click() { this.dispatch('click'); }
    focus() { doc.activeElement = this; }
    scrollIntoView() {}
    querySelectorAll(sel) {
        /* descendant combinators only: "a b c" narrows step by step */
        return String(sel).trim().split(/\s+/).reduce((scope, step) => {
            const out = [];
            const walk = (n) => {
                for (const c of n.children) { if (matches(c, step)) out.push(c); walk(c); }
            };
            scope.forEach(walk);
            return out;
        }, [this]);
    }
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
    /* test helper: flatten to a readable tree */
    dump(depth) {
        const pad = '  '.repeat(depth || 0);
        const cls = this.className ? '.' + this.className.split(' ').join('.') : '';
        const own = this._text ? ' "' + this._text.replace(/\n/g, '\\n') + '"' : '';
        return [pad + this.tag + cls + own]
            .concat(this.children.map((c) => c.dump((depth || 0) + 1))).join('\n');
    }
}

const doc = {
    _byId: new Map(),
    activeElement: null,
    createElement(tag) { return new El(tag); },
    createTextNode(t) { const e = new El('#text'); e.textContent = t; return e; },
    getElementById(id) { return doc._byId.get(id) || null; },
    addEventListener() {},
    body: null,
};

/* the panel's static markup, as ids the script expects */
function bootstrap(ids) {
    doc.body = new El('body');
    doc._byId.clear();
    for (const id of ids) {
        const e = new El(id === 'input' ? 'textarea' : id === 'driver' ? 'select' : 'div');
        e.id = id;
        e.value = '';
        doc.body.appendChild(e);
    }
    return doc;
}

module.exports = { El, doc, bootstrap };
