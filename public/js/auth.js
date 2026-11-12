let authMode = 'login';
let authReady = false;

function setAuthError(message='') {
    const el = document.getElementById('auth-error');
    if (el) el.textContent = message;
}
function switchAuthMode(mode) {
    authMode = mode === 'register' ? 'register' : 'login';
    document.getElementById('auth-tab-login')?.classList.toggle('active', authMode === 'login');
    document.getElementById('auth-tab-register')?.classList.toggle('active', authMode === 'register');
    document.getElementById('auth-password-confirm-wrap')?.classList.toggle('auth-hidden', authMode !== 'register');
    const submit = document.getElementById('auth-submit');
    if (submit) submit.textContent = authMode === 'register' ? 'СОЗДАТЬ АККАУНТ' : 'ВОЙТИ В ЗОНУ';
    setAuthError('');
}
function showAuthScreen() {
    document.getElementById('auth-screen')?.classList.add('show');
    document.getElementById('main-menu')?.classList.remove('show');
}
function hideAuthScreen() { document.getElementById('auth-screen')?.classList.remove('show'); }

async function submitAuth(event) {
    event.preventDefault();
    const username = document.getElementById('auth-username')?.value.trim() || '';
    const password = document.getElementById('auth-password')?.value || '';
    const confirm = document.getElementById('auth-password-confirm')?.value || '';
    const btn = document.getElementById('auth-submit');
    setAuthError('');
    if (authMode === 'register' && password !== confirm) return setAuthError('Пароли не совпадают.');
    if (btn) { btn.disabled = true; btn.textContent = 'ПОДКЛЮЧЕНИЕ...'; }
    try {
        const endpoint = authMode === 'register' ? '/api/auth/register' : '/api/auth/login';
        const data = await apiRequest(endpoint, { method:'POST', body:JSON.stringify({username,password}) });
        window.__playerLogin = data.username;
        window.__playerName = data.nickname || data.username;
        playerName = data.nickname || data.username;
        await loadCloudProgress();
        authReady = true;
        window.startZombixPresence?.();
        window.refreshZombixPublicStats?.();
        hideAuthScreen();
        const menu = document.getElementById('main-menu');
        if (menu) menu.style.display = 'flex';
        setTimeout(() => menu?.classList.add('show'), 10);
    } catch (e) {
        setAuthError(e.message);
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = authMode === 'register' ? 'СОЗДАТЬ АККАУНТ' : 'ВОЙТИ В ЗОНУ'; }
    }
}

async function checkExistingSession() {
    try {
        const data = await apiRequest('/api/me');
        applyServerState(data.state);
        window.__playerLogin = data.username;
        window.__playerName = data.nickname || data.state?.nickname || data.username;
        playerName = data.nickname || data.state?.nickname || data.username;
        authReady = true;
        window.startZombixPresence?.();
        window.refreshZombixPublicStats?.();
        hideAuthScreen();
        document.getElementById('main-menu')?.style.setProperty('display','flex');
        return true;
    } catch (_) {
        showAuthScreen();
        return false;
    }
}

document.addEventListener('DOMContentLoaded', () => { checkExistingSession(); });

function openChangePasswordModal(){
    openSimpleGameModal('СМЕНА ПАРОЛЯ', `<div class="account-field"><label>ТЕКУЩИЙ ПАРОЛЬ</label><input id="current-password-change" type="password" autocomplete="current-password"></div><div class="account-field"><label>НОВЫЙ ПАРОЛЬ</label><input id="new-password-change" type="password" minlength="6" maxlength="128" autocomplete="new-password"></div><div class="account-field"><label>ПОВТОР</label><input id="new-password-confirm-change" type="password" minlength="6" maxlength="128" autocomplete="new-password"></div><button class="profile-modal-btn" onclick="changePasswordFromModal();">СМЕНИТЬ ПАРОЛЬ</button>`);
}
async function changePasswordFromModal(){const c=document.getElementById('current-password-change')?.value||'',n=document.getElementById('new-password-change')?.value||'',r=document.getElementById('new-password-confirm-change')?.value||'';if(n!==r){showNotification('НОВЫЕ ПАРОЛИ НЕ СОВПАДАЮТ');return;}try{await apiRequest('/api/auth/change-password',{method:'POST',body:JSON.stringify({currentPassword:c,newPassword:n})});closeSimpleGameModal();showNotification('ПАРОЛЬ ИЗМЕНЁН');}catch(e){showNotification(e.message||'Не удалось изменить пароль');}}
function togglePasswordMask(){const el=document.getElementById('account-password-value');if(!el)return;el.textContent=el.textContent==='••••••••'?'ЗАЩИЩЁН':'••••••••';}
function updateAccountSettings(){const login=document.getElementById('account-login-value');if(login)login.textContent=window.__playerLogin||'—';const toggle=document.getElementById('account-messages-toggle');if(toggle){const allowed=GameState.settings?.allowMessages!==false;toggle.textContent=allowed?'РАЗРЕШЕНЫ':'ЗАПРЕЩЕНЫ';toggle.classList.toggle('is-off',!allowed);}}
function toggleAccountMessages(){GameState.settings.allowMessages=GameState.settings.allowMessages===false;settings=GameState.settings;updateAccountSettings();saveSettings();}
