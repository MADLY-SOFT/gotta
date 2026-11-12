// js/ui.js — ИНТЕРФЕЙС

let currentTabIndex = 0;
const tabOrder = ['shop', 'house', 'profile', 'other'];
let tabSwitchToken = 0;
let particlesInitialized = false;
let isTabSwitching = false;
let balanceTooltipTimeout = null;
let balanceTooltipVisible = false;



// Перекрашиваем только значки «Прочее»: сначала приводим исходную картинку к белой яркости,
// затем окрашиваем её цветом темы, сохраняя прозрачность, тени и пиксельный рисунок.
const otherIconColorCache = new Map();
function recolorOtherIcons(){
    const app=document.getElementById('app');
    const color=getComputedStyle(app||document.documentElement).getPropertyValue('--border-color').trim()||'#ffd700';
    document.querySelectorAll('#other-actions .other-action-btn img').forEach(img=>{
        const src=img.dataset.otherIconSrc || img.getAttribute('src'); if(!src) return;
        img.dataset.otherIconSrc=src;
        const key=src+'|'+color;
        if(otherIconColorCache.has(key)){img.src=otherIconColorCache.get(key);return;}
        const work=new Image(); work.onload=()=>{
            try{
                const canvas=document.createElement('canvas'),w=work.naturalWidth||work.width,h=work.naturalHeight||work.height;
                if(!w||!h)return; canvas.width=w;canvas.height=h;const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(work,0,0);
                const d=ctx.getImageData(0,0,w,h),hex=color.replace('#','');
                const cr=parseInt(hex.slice(0,2),16)||255,cg=parseInt(hex.slice(2,4),16)||215,cb=parseInt(hex.slice(4,6),16)||0;
                for(let i=0;i<d.data.length;i+=4){const a=d.data[i+3];if(!a)continue;const lum=(0.2126*d.data[i]+0.7152*d.data[i+1]+0.0722*d.data[i+2])/255;const white=Math.min(1,0.42+lum*0.58); d.data[i]=Math.round(cr*white); d.data[i+1]=Math.round(cg*white); d.data[i+2]=Math.round(cb*white);}
                ctx.putImageData(d,0,0);const out=canvas.toDataURL('image/png');otherIconColorCache.set(key,out);img.src=out;
            }catch(e){console.warn('[ICONS] colorize failed',e);}
        }; work.onerror=()=>{}; work.src=src;
    });
}

// ==================== УВЕДОМЛЕНИЯ ====================

let notificationTimer = null;
let lastNotificationText = '';
let lastNotificationAt = 0;
let notificationSerial = 0;

function showNotification(text, duration = 2400) {
    const n = document.getElementById('notification');
    if (!n) return;
    const value = String(text || '').trim();
    if (!value) return;
    const now = Date.now();
    if (value === lastNotificationText && now - lastNotificationAt < 900) return;
    lastNotificationText = value;
    lastNotificationAt = now;
    notificationSerial++;
    clearTimeout(notificationTimer);
    // Никакой очереди: новое уведомление мгновенно заменяет старое.
    n.classList.remove('show');
    n.style.display = 'block';
    n.textContent = value;
    requestAnimationFrame(() => n.classList.add('show'));
    const serial = notificationSerial;
    notificationTimer = setTimeout(() => {
        if (serial !== notificationSerial) return;
        dismissNotification();
    }, Math.max(1400, duration));
}

function dismissNotification() {
    const n = document.getElementById('notification');
    if (!n) return;
    clearTimeout(notificationTimer);
    notificationTimer = null;
    n.classList.remove('show');
    setTimeout(() => { if (!n.classList.contains('show')) n.style.display = 'none'; }, 180);
}

window.addEventListener('error', (event) => {
    // Ошибки отдельных картинок/шрифтов не являются ошибкой игрового действия и не должны спамить игрока.
    if (event.target && event.target !== window) return;
    console.error('[UI ERROR]', event.error || event.message);
    const msg = event?.error?.message || event?.message || 'Неизвестная ошибка';
    showNotification('ОШИБКА: ' + msg, 3200);
});
window.addEventListener('unhandledrejection', (event) => {
    console.error('[UI PROMISE ERROR]', event.reason);
    const msg = event?.reason?.message || String(event?.reason || 'Ошибка операции');
    showNotification('ОШИБКА: ' + msg, 3200);
});

function bindCoreUI() {
    document.getElementById('notification')?.addEventListener('click', dismissNotification);
    const tabsRoot = document.getElementById('tabs');
    if (tabsRoot && !tabsRoot.dataset.bound) {
        tabsRoot.dataset.bound = '1';
        tabsRoot.addEventListener('click', (event) => {
            const tab = event.target.closest('.tab[data-tab]');
            if (!tab || !tabsRoot.contains(tab)) return;
            event.preventDefault();
            try { playClick(); } catch (_) {}
            switchTab(tab.dataset.tab);
        });
    }
    const contractBtn = document.getElementById('open-contract-btn');
    contractBtn?.addEventListener('click', () => {
        try { playClick(); } catch (_) {}
        try { openContractModal(); } catch (e) { console.error(e); showNotification('НЕ УДАЛОСЬ ОТКРЫТЬ КОНТРАКТЫ'); }
    });
}

// ==================== ЧАСТИЦЫ ФОНА ====================

function createBackgroundParticles() {
    const container = document.getElementById('particles-container');
    if (!container || particlesInitialized) return;
    
    container.innerHTML = '';
    const particleCount = 8;
    const fragment = document.createDocumentFragment();
    
    for (let i = 0; i < particleCount; i++) {
        const p = document.createElement('div');
        const t = Math.random();
        
        if (t < 0.3) p.className = 'particle particle-dot';
        else if (t < 0.6) p.className = 'particle particle-small';
        else if (t < 0.85) p.className = 'particle particle-medium';
        else p.className = 'particle particle-star';
        
        p.style.left = Math.random() * 100 + '%';
        p.style.top = Math.random() * 100 + '%';
        p.style.animationDelay = Math.random() * 10 + 's';
        p.style.animationDuration = 8 + Math.random() * 15 + 's';
        p.style.setProperty('--drift-x', (Math.random() - 0.5) * 120 + 'px');
        
        fragment.appendChild(p);
    }
    
    container.appendChild(fragment);
    particlesInitialized = true;
}

// ==================== БАЛАНС ====================

function updateBalance() {
    const coinsEl = document.getElementById('coins');
    const gemsEl = document.getElementById('gems');
    if (coinsEl) coinsEl.textContent = formatNumber(GameState.coins);
    if (gemsEl) gemsEl.textContent = formatNumber(GameState.gems);
}

function toggleBalanceDisplay() {
    if (balanceTooltipVisible) {
        hideBalanceTooltip();
    } else {
        showBalanceTooltip();
    }
}

function showBalanceTooltip() {
    const tooltip = document.getElementById('balance-tooltip');
    if (!tooltip) return;
    
    tooltip.textContent = `🪙 ${formatNumberFull(GameState.coins)}    💎 ${formatNumberFull(GameState.gems)}`;
    tooltip.style.display = 'block';
    balanceTooltipVisible = true;
    
    if (balanceTooltipTimeout) clearTimeout(balanceTooltipTimeout);
    balanceTooltipTimeout = setTimeout(hideBalanceTooltip, 3000);
}

function hideBalanceTooltip() {
    const tooltip = document.getElementById('balance-tooltip');
    if (tooltip) tooltip.style.display = 'none';
    balanceTooltipVisible = false;
    if (balanceTooltipTimeout) clearTimeout(balanceTooltipTimeout);
}

// ==================== ОПЫТ ====================

// Опыт не изменяется клиентом: его начисляют только серверные игровые действия.
async function gainExperience() { return false; }


// ==================== ПЕРЕКЛЮЧЕНИЕ ВКЛАДОК ====================

function setActiveTabVisual(tab) {
    currentTabIndex = tabOrder.indexOf(tab);
    document.querySelectorAll('.tab').forEach(el => el.classList.toggle('active', el.id === 'tab-' + tab));
    document.querySelectorAll('.content-panel').forEach(panel => {
        const active = panel.id === 'panel-' + tab;
        panel.classList.toggle('active', active);
        panel.style.setProperty('display', active ? 'block' : 'none', 'important');
        panel.style.setProperty('opacity', active ? '1' : '0', 'important');
        panel.style.setProperty('visibility', active ? 'visible' : 'hidden', 'important');
        panel.style.setProperty('pointer-events', active ? 'auto' : 'none', 'important');
        panel.style.zIndex = active ? '20' : '1';
        if (active) panel.scrollTop = 0;
    });
}

function switchTab(tab) {
    if (!tabOrder.includes(tab)) return;
    if (typeof goBackFromRoulette === 'function' && document.getElementById('roulette-overlay')?.classList.contains('show')) {
        if (typeof isSpinning !== 'undefined' && isSpinning) {
            playError?.();
            return;
        }
        document.getElementById('roulette-overlay')?.classList.remove('show');
    }
    if (typeof currentRouletteCase !== 'undefined') currentRouletteCase = null;
    if (typeof currentRouletteResult !== 'undefined') currentRouletteResult = null;
    setActiveTabVisual(tab);
    try {
        if (tab === 'shop' && typeof renderCaseListView === 'function') renderCaseListView();
        if (tab === 'profile' && typeof renderProfile === 'function') renderProfile();
        if (tab === 'house' && typeof renderHouse === 'function') renderHouse();
        else if (typeof syncHouseAmbience === 'function') syncHouseAmbience();
        if (tab === 'other' && typeof refreshRewardIndicators === 'function') refreshRewardIndicators();
    } catch (e) {
        console.error('[TAB]', tab, e);
        showNotification('НЕ УДАЛОСЬ ОТКРЫТЬ РАЗДЕЛ: ' + tab.toUpperCase(), 3000);
    }
}

// ==================== НАСТРОЙКИ ====================

function openSettings() {
    const modal = document.getElementById('settings-modal');
    if (modal) modal.classList.add('show');
}

function closeSettings() {
    const modal = document.getElementById('settings-modal');
    if (modal) modal.classList.remove('show');
}

function openAccountSettings() {
    if (typeof updateAccountSettings === 'function') updateAccountSettings();
    const modal = document.getElementById('account-modal');
    if (modal) { modal.classList.add('show'); modal.setAttribute('aria-hidden','false'); }
}

function closeAccountSettings() {
    const modal = document.getElementById('account-modal');
    if (modal) { modal.classList.remove('show'); modal.setAttribute('aria-hidden','true'); }
}

function setSkin(skin) {
    settings.skin = skin;
    const app = document.getElementById('app');
    if (app) app.setAttribute('data-skin', skin);
    
    document.querySelectorAll('[id^="skin-"]').forEach(btn => {
        btn.classList.toggle('active', btn.id === 'skin-' + skin);
    });
    
    saveSettings();
    showNotification('СКИН ПРИМЕНЁН!');
    setTimeout(recolorOtherIcons, 0);
}

function setCorners(corners) {
    settings.corners = corners;
    const app = document.getElementById('app');
    if (app) app.setAttribute('data-corners', corners);
    
    document.querySelectorAll('[id^="corners-"]').forEach(btn => {
        btn.classList.toggle('active', btn.id === 'corners-' + corners);
    });
    
    saveSettings();
    showNotification('ФОРМА ПРИМЕНЕНА!');
}

// ==================== МОДАЛЬНЫЕ ОКНА ====================

function openConfirmModal(text, action) {
    const modal = document.getElementById('confirm-modal');
    const textEl = document.getElementById('confirm-text');
    if (!modal || !textEl) return;
    
    textEl.textContent = text;
    pendingConfirmAction = action;
    modal.classList.add('show');
}

function closeConfirmModal() {
    const modal = document.getElementById('confirm-modal');
    if (modal) modal.classList.remove('show');
    pendingConfirmAction = null;
}

function confirmYes() {
    if (pendingConfirmAction) pendingConfirmAction();
    closeConfirmModal();
}

function confirmNo() {
    closeConfirmModal();
}

// ==================== КОНФЕТТИ ====================

function spawnConfetti() {
    const container = document.getElementById('confetti-container');
    if (!container) return;
    
    container.innerHTML = '';
    const colors = ['#ffd700', '#ff6d00', '#4caf50', '#2196f3', '#9c27b0', '#ffffff'];
    const fragment = document.createDocumentFragment();
    
    for (let i = 0; i < 80; i++) {
        const piece = document.createElement('div');
        piece.className = 'confetti-piece';
        piece.style.left = Math.random() * 100 + '%';
        piece.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
        piece.style.animationDuration = (Math.random() * 2 + 2) + 's';
        fragment.appendChild(piece);
    }
    
    container.appendChild(fragment);
    setTimeout(() => container.innerHTML = '', 5000);
}

// ==================== МЕНЮ ====================

function showHowTo() {
    const sections = [
        ['png/cases/case_3.png','КЕЙСЫ','Выбирай кейс, смотри стоимость и доступные предметы. Открывай по одному или несколько за раз — результат открытия определяется сервером.'],
        ['item:151','ИНВЕНТАРЬ','Все полученные предметы сохраняются в профиле. Изучай находки, выбирай предметы для продажи и используй нужные вещи в контрактах.'],
        ['png/ui/contracts.png','КОНТРАКТЫ','Обменивай подходящие предметы по условиям контракта. Перед подтверждением проверяй состав и награду.'],
        ['png/houses/house_2.png','УБЕЖИЩЕ','Развивай дом, улучшай его уровень и забирай накопленный доход. Улучшения требуют игровых ресурсов.'],
        ['png/ui/daily_rewards.png','ЕЖЕДНЕВНЫЕ НАГРАДЫ','Заходи регулярно и забирай доступную награду текущего дня. Следующий шаг зависит от календаря наград.'],
        ['png/ui/market-artifacts.png','РЫНОК АРТЕФАКТОВ','Изучай предложения игроков и выставляй собственные артефакты. Цена и доступность лотов могут меняться.'],
        ['png/ui/home.png','ПРОФИЛЬ И ПРОГРЕСС','Следи за уровнем, рейтингом и достижениями. Выполняй задания, чтобы получать предусмотренные игрой награды.']
    ];
    const body = `<div class="howto-guide-intro">ZOMBIX — симулятор открытия кейсов, коллекционирования предметов и развития аккаунта. Выбирай направление и постепенно развивай свой профиль.</div><div class="howto-guide-grid">${sections.map(([image,title,description])=>`<article class="howto-guide-card"><div class="howto-guide-image">${String(image).startsWith('item:') ? itemSprite(String(image).slice(5), 'howto-item-atlas') : `<img src="${image}" alt="">`}</div><div class="howto-guide-copy"><b>${title}</b><p>${description}</p></div></article>`).join('')}</div>`;
    if (typeof openSimpleGameModal === 'function') {
        openSimpleGameModal('ПУТЕВОДИТЕЛЬ ZOMBIX', body);
        document.querySelector('#simple-game-modal .simple-game-card')?.classList.add('howto-guide-modal');
    }
}

function goToMenu() {
    // Останавливаем все интервалы
    if (typeof liveIncomeInterval !== 'undefined' && liveIncomeInterval) {
        clearInterval(liveIncomeInterval);
        liveIncomeInterval = null;
    }
    if (typeof searchCooldownInterval !== 'undefined' && searchCooldownInterval) {
        clearInterval(searchCooldownInterval);
        searchCooldownInterval = null;
    }
    
    hideBalanceTooltip();
    
    const gameScreen = document.getElementById('game-screen');
    const mainMenu = document.getElementById('main-menu');
    
    if (gameScreen) gameScreen.style.display = 'none';
    if (mainMenu) mainMenu.style.display = 'flex';
    
    // Сохраняем
    forceSave();
    
}

// ==================== МАГАЗИН МОНЕТ ====================

function openCoinsShop() {
    let modal = document.getElementById('coins-shop-modal');
    
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'coins-shop-modal';
        modal.className = 'coins-shop-overlay';
        modal.innerHTML = `
            <section class="coins-shop-panel" role="dialog" aria-modal="true" aria-labelledby="coins-shop-title">
                <header class="coins-shop-head">
                    <div><small>БЕСПЛАТНО КАЖДЫЙ ДЕНЬ</small><h3 id="coins-shop-title">МАГАЗИН ВАЛЮТ</h3></div>
                    <button class="coins-shop-x" onclick="playClick(); closeCoinsShop();" aria-label="Закрыть"><i class="pixel-close-icon" aria-hidden="true"></i></button>
                </header>
                <div id="coins-shop-content"></div>
                <button class="coins-shop-close" onclick="playClick(); closeCoinsShop();">ЗАКРЫТЬ</button>
            </section>
        `;
        (document.getElementById('app') || document.body).appendChild(modal);
    }
    
    modal.style.display = 'flex';
    renderCoinsShop();
}

function closeCoinsShop() {
    const m = document.getElementById('coins-shop-modal');
    if (m) m.style.display = 'none';
}

function renderCoinsShop() {
    const shop = document.getElementById('coins-shop-content');
    if (!shop) return;
    
    shop.innerHTML = '';
    
    const now = Date.now();
    const todayKey = (() => { const d=new Date(now+3*60*60*1000); return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`; })();
    const usedToday = GameState.adCoinsDayKey===todayKey ? Number(GameState.adCoinsDailyCount||0) : 0;
    const remainingToday = Math.max(0,20-usedToday);
    const adTimeLeft = 60000 - (now - GameState.lastAdCoinsTime);
    const adAvailable = adTimeLeft <= 0 && remainingToday > 0;
    const adSeconds = Math.max(0, Math.ceil(adTimeLeft / 1000));
    const adStatus = remainingToday<=0 ? 'ЛИМИТ НА СЕГОДНЯ' : (adAvailable ? 'ДОСТУПНО' : 'ЧЕРЕЗ ' + adSeconds + ' СЕК');
    
    const adPack = document.createElement('div');
    adPack.className = 'coin-pack' + (adAvailable ? '' : ' disabled');
    adPack.setAttribute('role', 'button');
    adPack.setAttribute('aria-disabled', String(!adAvailable));
    adPack.innerHTML = `
        <div class="pack-icon"><img src="${PATHS.coin}" alt=""><span class="pack-play" aria-hidden="true"></span></div>
        <div class="pack-body">
            <div class="pack-name">150 МОНЕТ</div>
            <div class="pack-price">ЗА РЕКЛАМУ</div>
        </div>
        <div class="pack-timer ${adAvailable ? '' : 'urgent'}" id="ad-timer">${adStatus}</div>
        <div class="pack-limit"><span>${remainingToday} НАГРАД СЕГОДНЯ</span><i class="pack-progress"><b style="width:${Math.round(remainingToday / 20 * 100)}%"></b></i></div>
    `;
    
    adPack.onclick = () => {
        if (!adAvailable) {
            playError();
            return;
        }
        
        playClick();
        
        gameAction('adCoins').then(data => {
            updateBalance();
            showNotification(`+${data.result?.coins || 150} МОНЕТ!`);
            renderCoinsShop();
        }).catch(e => {
            playError();
            showNotification(e.message || 'Награда недоступна');
            renderCoinsShop();
        });
    };
    
    shop.appendChild(adPack);
}

// ==================== ТАЙМЕР МАГАЗИНА ====================

let coinsShopTimerInterval = null;

function startCoinsShopTimer() {
    if (coinsShopTimerInterval) return;
    
    coinsShopTimerInterval = setInterval(() => {
        const timer = document.getElementById('ad-timer');
        const modal = document.getElementById('coins-shop-modal');
        
        if (timer && modal && modal.style.display === 'flex') {
            const now=Date.now(); const d=new Date(now+3*60*60*1000); const today=`${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`; const used=GameState.adCoinsDayKey===today?Number(GameState.adCoinsDailyCount||0):0; const remaining=Math.max(0,20-used); const left=60000-(now-GameState.lastAdCoinsTime);
            if(remaining<=0){timer.textContent='ЛИМИТ НА СЕГОДНЯ';timer.classList.add('urgent');}
            else if(left>0){timer.textContent='ЧЕРЕЗ '+Math.ceil(left/1000)+' СЕК';timer.classList.add('urgent');}
            else{timer.textContent='ДОСТУПНО';timer.classList.remove('urgent');}
        }
    }, 1000);
}

function stopCoinsShopTimer() {
    if (coinsShopTimerInterval) {
        clearInterval(coinsShopTimerInterval);
        coinsShopTimerInterval = null;
    }
}

// ==================== КЛИК ВНЕ МОДАЛОК ====================

document.addEventListener('click', (e) => {
    if (balanceTooltipVisible && !e.target.closest('.top-balance-item')) {
        hideBalanceTooltip();
    }
});

// ==================== ИНИЦИАЛИЗАЦИЯ ====================

document.addEventListener('DOMContentLoaded', () => {
    // Модальные окна всегда закрыты при загрузке. Награды открываются только по кнопке.
    const dailyModal = document.getElementById('daily-rewards-modal');
    if (dailyModal) {
        dailyModal.classList.remove('show');
        dailyModal.setAttribute('aria-hidden', 'true');
        dailyModal.style.display = 'none';
    }
    const shopPanel = document.getElementById('panel-shop');
    if (shopPanel) shopPanel.dataset.view = 'list';
    createBackgroundParticles();
    startCoinsShopTimer();
    bindCoreUI();
});

console.log('[UI] Модуль интерфейса загружен');