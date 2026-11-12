// js/sdk.js — ЛОКАЛЬНЫЙ API + SQLITE
let playerName = 'СТАЛКЕР';
let player = null;
let apiBusy = false;
let saveQueued = false;
let pendingCaseOpenKey = null;

function getCaseOpenIdempotencyKey() {
    if (pendingCaseOpenKey) return pendingCaseOpenKey;
    try { pendingCaseOpenKey = sessionStorage.getItem('zombixPendingCaseOpenV86'); } catch (_) {}
    if (!/^[A-Za-z0-9_-]{16,80}$/.test(String(pendingCaseOpenKey || ''))) {
        pendingCaseOpenKey = typeof crypto !== 'undefined' && crypto.randomUUID
            ? crypto.randomUUID().replaceAll('-', '')
            : `z${Date.now().toString(36)}${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
    }
    try { sessionStorage.setItem('zombixPendingCaseOpenV86', pendingCaseOpenKey); } catch (_) {}
    return pendingCaseOpenKey;
}

function clearCaseOpenIdempotencyKey() {
    pendingCaseOpenKey = null;
    try { sessionStorage.removeItem('zombixPendingCaseOpenV86'); } catch (_) {}
}

async function apiRequest(url, options = {}) {
    const { timeoutMs = 20000, signal: callerSignal, ...fetchOptions } = options;
    const controller = new AbortController();
    let timedOut = false;
    const timeout = Math.max(1000, Math.min(60000, Number(timeoutMs) || 20000));
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeout);
    const abortFromCaller = () => controller.abort(callerSignal?.reason);
    if (callerSignal) {
        if (callerSignal.aborted) abortFromCaller();
        else callerSignal.addEventListener('abort', abortFromCaller, { once: true });
    }
    try {
        const response = await fetch(url, {
            credentials: 'same-origin',
            ...fetchOptions,
            signal: controller.signal,
            headers: { 'Content-Type': 'application/json', ...(fetchOptions.headers || {}) }
        });
        let data = null;
        try { data = await response.json(); } catch (_) {}
        if (!response.ok || !data?.ok) throw new Error(data?.error || `HTTP ${response.status}`);
        return data;
    } catch (error) {
        if (timedOut) throw new Error('Сервер не ответил вовремя. Проверь соединение и повтори попытку.');
        throw error;
    } finally {
        clearTimeout(timer);
        callerSignal?.removeEventListener('abort', abortFromCaller);
    }
}

async function initLocalPlatform() { return true; }

function applyServerState(state) {
    if (!state) return;
    for (const key of Object.keys(GameState)) {
        if (state[key] !== undefined) GameState[key] = state[key];
    }
    syncGlobalsFromState();
}

async function loadCloudProgress() {
    const data = await apiRequest('/api/me');
    applyServerState(data.state);
    playerName = data.nickname || data.state?.nickname || data.username;
    window.__playerName = playerName;
    return true;
}

let pendingGameActionRequest = null;
const PENDING_ACTION_STORAGE_KEY = 'zombixPendingActionV1';
function getGenericActionIdempotencyKey(action, payload) {
    const fingerprint = `${action}:${JSON.stringify(payload || {})}`;
    if (pendingGameActionRequest?.fingerprint === fingerprint) return pendingGameActionRequest.key;
    try {
        const stored = JSON.parse(sessionStorage.getItem(PENDING_ACTION_STORAGE_KEY) || 'null');
        if (stored?.fingerprint === fingerprint && typeof stored.key === 'string') {
            pendingGameActionRequest = stored;
            return stored.key;
        }
    } catch (_) {}
    let key;
    try { key = globalThis.crypto?.randomUUID?.(); } catch (_) {}
    if (!key) key = `act_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 14)}`;
    pendingGameActionRequest = { fingerprint, key };
    try { sessionStorage.setItem(PENDING_ACTION_STORAGE_KEY, JSON.stringify(pendingGameActionRequest)); } catch (_) {}
    return key;
}
function clearGenericActionIdempotencyKey(key) {
    if (pendingGameActionRequest?.key === key) pendingGameActionRequest = null;
    try {
        const stored = JSON.parse(sessionStorage.getItem(PENDING_ACTION_STORAGE_KEY) || 'null');
        if (stored?.key === key) sessionStorage.removeItem(PENDING_ACTION_STORAGE_KEY);
    } catch (_) {}
}

async function idempotentApiAction(namespace, endpoint, payload) {
    const fingerprint = `${namespace}:${JSON.stringify(payload || {})}`;
    const storageKey = `zombixPendingApiAction:${namespace}`;
    let key = null;
    try {
        const stored = JSON.parse(sessionStorage.getItem(storageKey) || 'null');
        if (stored?.fingerprint === fingerprint && typeof stored.key === 'string') key = stored.key;
    } catch (_) {}
    if (!key) {
        try { key = globalThis.crypto?.randomUUID?.(); } catch (_) {}
        if (!key) key = `api_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 14)}`;
        try { sessionStorage.setItem(storageKey, JSON.stringify({ fingerprint, key })); } catch (_) {}
    }
    const data = await apiRequest(endpoint, { method: 'POST', body: JSON.stringify({ ...payload, idempotencyKey: key }) });
    try {
        const stored = JSON.parse(sessionStorage.getItem(storageKey) || 'null');
        if (stored?.key === key) sessionStorage.removeItem(storageKey);
    } catch (_) {}
    return data;
}

async function gameAction(action, payload = {}) {
    if (apiBusy) {
        // Serialize state-changing calls so local state cannot overwrite a newer response.
        await new Promise(r => setTimeout(r, 80));
        return gameAction(action, payload);
    }
    apiBusy = true;
    const isCaseOpening = action === 'openCase';
    const idempotencyKey = isCaseOpening ? getCaseOpenIdempotencyKey() : getGenericActionIdempotencyKey(action, payload);
    try {
        const data = await apiRequest('/api/action', {
            method: 'POST',
            body: JSON.stringify({ action, payload, ...(idempotencyKey ? { idempotencyKey } : {}) })
        });
        applyServerState(data.state);
        if (isCaseOpening) clearCaseOpenIdempotencyKey();
        else clearGenericActionIdempotencyKey(idempotencyKey);
        return data;
    } finally {
        // Keep the pending key after transport errors; the next identical call
        // replays a committed result instead of applying a second mutation.
        apiBusy = false;
    }
}

// Legacy compatibility shims: состояние сохраняется только через серверные игровые действия.
function saveProgress() { return Promise.resolve(true); }
function forceSave() { return Promise.resolve(true); }
async function saveSettings() {
    try { await gameAction('settings', { settings: GameState.settings }); return true; }
    catch (e) { console.warn('[SETTINGS]', e.message); return false; }
}

async function logoutGame() {
    try { await apiRequest('/api/auth/logout', { method: 'POST', body: '{}' }); } catch (_) {}
    location.reload();
}

async function updateLeaderboard() {
    try {
        const data = await apiRequest('/api/leaderboard?limit=10');
        window.__leaderboard = data.players || [];
        return window.__leaderboard;
    } catch (e) {
        console.warn('[LEADERBOARD]', e.message);
        return [];
    }
}

async function openLeaderboard() {
    const modal = document.getElementById('leaderboard-modal');
    const list = document.getElementById('leaderboard-list');
    if (!modal || !list) return;
    modal.classList.add('show');
    list.innerHTML = '<li style="padding:20px;color:var(--text-secondary);font-size:8px;">ЗАГРУЗКА...</li>';
    const rows = await updateLeaderboard();
    if (!rows.length) {
        list.innerHTML = '<li style="padding:20px;color:var(--text-secondary);font-size:8px;">ПОКА НЕТ ИГРОКОВ</li>';
        return;
    }
    list.innerHTML = rows.map(row => {
        const current = row.username === playerName ? ' current' : '';
        return `<li class="leaderboard-entry${current}">
            <span class="leaderboard-rank">#${row.rank}</span>
            <span class="leaderboard-name">${escapeHtml(row.username)}</span>
            <span class="leaderboard-score">УР. ${row.level} · ${row.experience} XP</span>
        </li>`;
    }).join('');
}

function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
}

window.addEventListener('online', () => forceSave());

function closeLeaderboard() {
    document.getElementById('leaderboard-modal')?.classList.remove('show');
}
