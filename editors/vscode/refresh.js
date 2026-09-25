/* One board refresh at a time.
 *
 * Every trigger funnels through here: a spec file changing, an agent's turn
 * ending, a command finishing, the poll. A refresh is a short chain of cg
 * calls, and under a fleet of agents the triggers arrive faster than the
 * chain runs — the extension used to be part of the process storm it was
 * reporting on. The contract:
 *
 *   - one chain in flight, never two;
 *   - a request during a run queues at most one trailing run, which sees
 *     everything that happened during the first;
 *   - a burst of requests debounces into one run;
 *   - a floor between runs for everything except an explicit request
 *     (delay 0), which runs as soon as nothing is in flight.
 *
 * Plain Node with no vscode import, so the contract is testable from a
 * shell the same way the LSP client is. */
function createRefresher(work, opts = {}) {
    const debounceMs = opts.debounceMs === undefined ? 400 : opts.debounceMs;
    const minGapMs = opts.minGapMs === undefined ? 2000 : opts.minGapMs;
    let timer;
    let due = 0;
    let running = null;
    let queued = false;
    let queuedUrgent = false;
    let waiters = [];
    let lastEnd = 0;
    let runs = 0;

    function start() {
        if (timer) { clearTimeout(timer); timer = undefined; }
        const mine = waiters;
        waiters = [];
        runs += 1;
        running = Promise.resolve()
            .then(() => work())
            .catch(() => {})
            .then(() => {
                lastEnd = Date.now();
                running = null;
                for (const w of mine) w();
                if (queued) {
                    const urgent = queuedUrgent;
                    queued = false;
                    queuedUrgent = false;
                    schedule(urgent ? 0 : debounceMs);
                }
            });
        return running;
    }

    /* Resolves once a run that started after this call has completed.
     * delay 0 asks for the next possible run; anything else is a hint that
     * debounces and honours the floor. */
    function schedule(delayMs) {
        const p = new Promise((resolve) => waiters.push(resolve));
        const urgent = delayMs === 0;
        if (running) {
            queued = true;
            if (urgent) queuedUrgent = true;
            return p;
        }
        if (urgent) { start(); return p; }
        const hint = delayMs === undefined ? debounceMs : delayMs;
        const wait = Math.max(hint, minGapMs - (Date.now() - lastEnd), 0);
        const at = Date.now() + wait;
        if (timer && due <= at) return p;   /* an earlier deadline covers it */
        if (timer) clearTimeout(timer);
        due = at;
        timer = setTimeout(() => { timer = undefined; start(); }, wait);
        return p;
    }

    function dispose() {
        if (timer) { clearTimeout(timer); timer = undefined; }
        queued = false;
        queuedUrgent = false;
        const left = waiters;
        waiters = [];
        for (const w of left) w();
    }

    return {
        schedule,
        dispose,
        get inFlight() { return running !== null; },
        get runs() { return runs; },
    };
}

module.exports = { createRefresher };
