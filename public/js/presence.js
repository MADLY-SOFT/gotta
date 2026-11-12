// Server-backed presence and public statistics. Counts are never fabricated.
(() => {
    let timer = null;
    let statsTimer = null;
    let inFlight = false;
    const $ = id => document.getElementById(id);
    const put = (id, value) => { const el = $(id); if (el) el.textContent = String(value); };

    async function refreshPublicStats() {
        try {
            const response = await fetch('/api/public/stats', { credentials: 'same-origin', cache: 'no-store' });
            if (!response.ok) throw new Error('stats unavailable');
            const data = await response.json();
            if (!data?.ok) throw new Error('stats unavailable');
            put('menu-online-count', data.online);

        } catch (_) {
            put('menu-online-count', '—');

        }
    }

    async function heartbeat() {
        if (inFlight || document.visibilityState !== 'visible') return;
        inFlight = true;
        try {
            await fetch('/api/presence', {
                method: 'POST', credentials: 'same-origin',
                headers: {'Content-Type':'application/json'},
                body: JSON.stringify({clientKind:'web'})
            });
        } catch (_) {
            // The game remains playable if presence reporting is temporarily unavailable.
        } finally { inFlight = false; }
    }

    function start() {
        heartbeat();
        if (timer) clearInterval(timer);
        timer = setInterval(heartbeat, 35000);
    }
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') heartbeat();
    });
    document.addEventListener('DOMContentLoaded', () => {
        refreshPublicStats();
        statsTimer = setInterval(refreshPublicStats, 20000);
        start();
    });
    window.refreshZombixPublicStats = refreshPublicStats;
    window.startZombixPresence = start;
})();
