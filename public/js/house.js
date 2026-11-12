// js/house.js — СИСТЕМА ДОМА

let houseBackgroundCooldown = 0;
let liveIncomeInterval = null;
let isCollecting = false;
let isUpgrading = false;
let houseAnimationsAdded = false;

// ==================== РАСЧЁТ ДОХОДА ====================

function calculateHouseIncome() { 
    const now = Date.now(); 
    const minutesPassed = Math.floor((now - GameState.lastHouseCollectTime) / INCOME_INTERVAL_MS); 
    if (minutesPassed <= 0) return 0; 
    
    const houseData = getHouseLevelData(GameState.houseLevel); 
    const minutes = Math.min(minutesPassed, MAX_COLLECT_MINUTES); 
    return minutes * (houseData.incomePerMinute || 0); 
}

function getMaxIncomeForCurrentLevel() {
    const houseData = getHouseLevelData(GameState.houseLevel);
    return MAX_COLLECT_MINUTES * (houseData.incomePerMinute || 0);
}

// ==================== СБОР ДОХОДА ====================

async function collectHouseIncome() {
    if (isCollecting) return;
    isCollecting=true;
    try {
        const data=await gameAction('collectHouse');
        const income=data.result?.income||0;
        playHouseCollect(); updateBalance(); renderHouse();
        showNotification(`ДОМ ПРИНЁС ${income} МОНЕТ!`);
    } catch(e) { playError(); showNotification(e.message||'Дом пока не принёс доход'); }
    finally { isCollecting=false; }
}

// ==================== УЛУЧШЕНИЕ ДОМА ====================

function hasRequiredItems(requiredItems) { 
    if (!requiredItems || requiredItems.length === 0) return true; 
    for (const req of requiredItems) { 
        const countInInventory = GameState.inventory.filter(item => item.id === req.itemId && item.tier === req.tier).length; 
        if (countInInventory < req.count) return false; 
    } 
    return true; 
}

function removeRequiredItems(requiredItems) { 
    if (!requiredItems || requiredItems.length === 0) return; 
    for (const req of requiredItems) { 
        let removed = 0; 
        for (let i = GameState.inventory.length - 1; i >= 0 && removed < req.count; i--) { 
            if (GameState.inventory[i].id === req.itemId && GameState.inventory[i].tier === req.tier) { 
                GameState.inventory.splice(i, 1); 
                removed++; 
            } 
        } 
    } 
}

async function upgradeHouse() {
    if (isUpgrading || GameState.houseLevel >= 30) return;
    isUpgrading=true;
    try {
        const data=await gameAction('upgradeHouse');
        updateBalance(); renderHouse();
        closeHouseUpgradeModal();
        const rr=Number(data.result?.rating||0);
        showNotification(`ДОМ УЛУЧШЕН ДО УРОВНЯ ${data.result?.houseLevel||GameState.houseLevel}!${rr?` +${rr} РЕЙТИНГА`:''}`);
    } catch(e) { playError(); showNotification(e.message||'Не удалось улучшить дом'); }
    finally { isUpgrading=false; }
}

// ==================== ФОН ДОМА ====================

function getSelectedBackground() {
    return HOUSE_DATABASE.backgrounds?.find(b => b.id === GameState.selectedHouseBackground) || HOUSE_DATABASE.backgrounds?.[0];
}

function openHouseBackgroundModal() {
    const app = document.getElementById('app');
    if (!app) return;
    
    let modal = document.getElementById('house-background-modal');
    
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'house-background-modal';
        modal.className = 'house-modal';
        modal.innerHTML = `<div id="house-background-content" class="house-modal-card" role="dialog" aria-modal="true" aria-label="Фон убежища"></div>`;
        app.appendChild(modal);
    }
    
    const content = document.getElementById('house-background-content');
    if (!content) return;
    
    const cards = (HOUSE_DATABASE.backgrounds || []).map(bg => {
        const isOwned = GameState.ownedHouseBackgrounds.includes(bg.id);
        const isSelected = GameState.selectedHouseBackground === bg.id;
        const currencyIcon = bg.currency === 'gems' ? PATHS.gem : PATHS.coin;
        const badge = isSelected
            ? '<span class="house-bg-badge selected">✓ ВЫБРАН</span>'
            : isOwned ? '<span class="house-bg-badge">КУПЛЕН</span>'
            : `<span class="house-bg-price"><img src="${currencyIcon}" alt="" onerror="this.style.display='none';">${bg.price}</span>`;
        return `<button type="button" class="house-bg-card${isSelected ? ' selected' : ''}${isOwned ? ' owned' : ''}" style="background:${bg.css}" onclick="playClick(); selectHouseBackground('${bg.id}');"><span class="house-bg-name">${escapeHtml(bg.name)}</span>${badge}</button>`;
    }).join('');
    
    content.innerHTML = `
        <header class="house-modal-head"><span class="house-modal-kicker">ОФОРМЛЕНИЕ</span><div class="house-modal-title">ФОН УБЕЖИЩА</div><p class="house-modal-desc">Смена фона — не чаще раза в 5 секунд</p></header>
        <div class="house-modal-body"><div class="house-bg-grid">${cards}</div></div>
        <footer class="house-modal-actions"><button class="house-close-btn" onclick="playClick(); closeHouseBackgroundModal();">ЗАКРЫТЬ</button></footer>`;
    modal.style.display = 'flex';
}

function closeHouseBackgroundModal() {
    const modal = document.getElementById('house-background-modal');
    if (modal) modal.style.display = 'none';
}

async function selectHouseBackground(bgId) {
    if (houseBackgroundCooldown>Date.now()) { playError(); showNotification('ПОДОЖДИТЕ 5 СЕК'); return; }
    const bg=HOUSE_DATABASE.backgrounds?.find(b=>b.id===bgId); if(!bg)return;
    houseBackgroundCooldown=Date.now()+5000;
    try { await gameAction('buyBackground',{bgId}); updateBalance(); renderHouse(); closeHouseBackgroundModal(); showNotification('ФОН ВЫБРАН!'); }
    catch(e){ playError(); showNotification(e.message||'Не удалось выбрать фон'); }
}

// ==================== МОДАЛЬНЫЕ ОКНА ====================

function openHouseIncomeModal() {
    const modal = document.getElementById('house-income-modal');
    const content = document.getElementById('house-income-content');
    if (!modal || !content) return;
    
    const currentHouseData = getHouseLevelData(GameState.houseLevel);
    if (GameState.houseLevel >= 30) { openHouseResetModal(); return; }
    const pendingIncome = calculateHouseIncome();
    const maxIncome = getMaxIncomeForCurrentLevel();
    const maxHours = Math.floor(MAX_COLLECT_MINUTES / 60);
    
    const coin = houseCoinIcon();
    const fill = maxIncome ? Math.min(100, Math.round(pendingIncome / maxIncome * 100)) : 0;
    content.innerHTML = `
        <header class="house-modal-head"><span class="house-modal-kicker">ДОХОД УБЕЖИЩА</span><div class="house-modal-title">${escapeHtml(currentHouseData.name)}</div><p class="house-modal-desc">${escapeHtml(currentHouseData.description || '')}</p></header>
        <div class="house-modal-body">
            <div class="house-income-hero"><small>НАКОПЛЕНО</small><b>${coin}${pendingIncome}</b><div class="house-meter"><i style="width:${fill}%"></i></div><span>${fill}% хранилища заполнено</span></div>
            <div class="house-kv"><span>Доход в минуту</span><b>${coin}${currentHouseData.incomePerMinute || 0}</b></div>
            <div class="house-kv"><span>Лимит хранилища · ${maxHours} ч</span><b>${coin}${maxIncome}</b></div>
        </div>
        <footer class="house-modal-actions">
            <button class="house-btn house-btn-primary" onclick="playClick(); collectHouseIncome(); closeHouseIncomeModal();">${coin}ЗАБРАТЬ ${pendingIncome}</button>
            <button class="house-close-btn" onclick="playClick(); closeHouseIncomeModal();">ЗАКРЫТЬ</button>
        </footer>
    `;
    modal.classList.add('show');
}

function closeHouseIncomeModal() { 
    const modal = document.getElementById('house-income-modal');
    if (modal) modal.classList.remove('show'); 
}

function openHouseUpgradeModal() {
    const modal = document.getElementById('house-upgrade-modal');
    const content = document.getElementById('house-upgrade-content');
    if (!modal || !content) return;
    
    const currentHouseData = getHouseLevelData(GameState.houseLevel);
    const isMaxLevel = GameState.houseLevel >= HOUSE_DATABASE.maxLevel;
    const pendingIncome = calculateHouseIncome();
    const totalCoinsAvailable = GameState.coins + pendingIncome;
    
    if (isMaxLevel) {
        content.innerHTML = `
            <header class="house-modal-head"><span class="house-modal-kicker">УЛУЧШЕНИЕ</span><div class="house-modal-title">МАКСИМАЛЬНЫЙ УРОВЕНЬ!</div><p class="house-modal-desc">${escapeHtml(currentHouseData.name)}</p></header>
            <footer class="house-modal-actions"><button class="house-close-btn" onclick="playClick(); closeHouseUpgradeModal();">ЗАКРЫТЬ</button></footer>
        `;
        modal.classList.add('show');
        return;
    }
    
    const costCoins = currentHouseData.upgradeCostCoins || 0;
    const costGems = currentHouseData.upgradeCostGems || 0;
    const requiredItems = currentHouseData.requiredItems || [];
    
    const reqRow = (ok, icon, name, value, extra = '') => `<div class="house-req ${ok ? 'ok' : 'missing'}${extra}"><span class="house-req-icon">${icon}</span><span class="house-req-name">${name}</span><b>${value}</b></div>`;
    let requirementsHTML = '';
    
    if (costCoins > 0) {
        const hasCoins = totalCoinsAvailable >= costCoins;
        requirementsHTML += reqRow(hasCoins, houseCoinIcon(), `Монеты<small>${costCoins}</small>`, `${GameState.coins}${pendingIncome > 0 ? ' + ' + pendingIncome : ''}/${costCoins}`);
    }
    
    if (costGems > 0) {
        const hasGems = GameState.gems >= costGems;
        requirementsHTML += reqRow(hasGems, `<img src="${PATHS.gem}" alt="" onerror="this.style.display='none';">`, `Гемы<small>${costGems}</small>`, `${GameState.gems}/${costGems}`);
    }
    
    requiredItems.forEach(req => {
        const itemData = getItemById(req.itemId);
        const countInInventory = GameState.inventory.filter(item => item.id === req.itemId && item.tier === req.tier).length;
        const isEnough = countInInventory >= req.count;
        requirementsHTML += reqRow(isEnough, itemSprite(itemData?.image, `house-required-item tier-${req.tier}`), `${escapeHtml(itemData ? itemData.name : 'Предмет')}<small>${tierNames[req.tier]}</small>`, `${countInInventory}/${req.count}`, ` house-req-item tier-${req.tier}`);
    });
    
    const autoCollectHTML = pendingIncome > 0
        ? `<div class="house-note">${houseCoinIcon()}<span>При улучшении будет собран доход: <b>${pendingIncome}</b> монет</span></div>`
        : '';
    
    const nextHouseData = getHouseLevelData(GameState.houseLevel + 1);
    // Same clamp the server applies when granting upgrade rating.
    const rewardRating = Math.max(5, Math.min(15, Math.floor(Number(currentHouseData.upgradeRating) || 5)));
    
    content.innerHTML = `
        <header class="house-modal-head"><span class="house-modal-kicker">УЛУЧШЕНИЕ · УР. ${GameState.houseLevel} → ${GameState.houseLevel + 1}</span><div class="house-modal-title">${escapeHtml(nextHouseData.name)}</div><p class="house-modal-desc">${escapeHtml(nextHouseData.description || '')}</p></header>
        <div class="house-modal-body">
            <div class="house-upgrade-compare">
                <div><small>СЕЙЧАС</small><b>${houseCoinIcon()}${currentHouseData.incomePerMinute || 0}</b><span>в минуту</span></div>
                <i aria-hidden="true"></i>
                <div class="next"><small>ПОСЛЕ</small><b>${houseCoinIcon()}${nextHouseData.incomePerMinute || 0}</b><span>в минуту</span></div>
            </div>
            ${rewardRating ? `<div class="house-note house-note-accent"><span>Награда за улучшение: <b>+${rewardRating} рейтинга</b></span></div>` : ''}
            ${autoCollectHTML}
            ${requirementsHTML ? `<div class="house-section-label">ТРЕБУЕТСЯ</div><div class="house-req-list">${requirementsHTML}</div>` : ''}
        </div>
        <footer class="house-modal-actions">
            <button class="house-btn house-btn-primary" onclick="playClick(); upgradeHouse(); closeHouseUpgradeModal();">${HOUSE_ICONS.up}УЛУЧШИТЬ</button>
            <button class="house-close-btn" onclick="playClick(); closeHouseUpgradeModal();">ЗАКРЫТЬ</button>
        </footer>
    `;
    modal.classList.add('show');
}

function closeHouseUpgradeModal() { 
    const modal = document.getElementById('house-upgrade-modal');
    if (modal) modal.classList.remove('show'); 
}


// ==================== ПРОДАЖА / ПЕРЕЗАПУСК БАЗЫ ====================
function openHouseResetModal() {
    const app=document.getElementById('app'); if(!app)return;
    let modal=document.getElementById('house-reset-modal');
    if(!modal){
        modal=document.createElement('div'); modal.id='house-reset-modal'; modal.className='house-modal';
        modal.innerHTML='<div id="house-reset-content" class="house-modal-card" role="dialog" aria-modal="true" aria-label="Продажа убежища"></div>';
        app.appendChild(modal);
    }
    const c=document.getElementById('house-reset-content');
    c.innerHTML=`
      <header class="house-modal-head"><span class="house-modal-kicker">НОВЫЙ ЦИКЛ</span><div class="house-modal-title">ПРОДАТЬ УБЕЖИЩЕ?</div><p class="house-modal-desc">Ваше убежище достигло 30 уровня. Его можно продать и начать развитие заново.</p></header>
      <div class="house-modal-body">
        <div class="house-kv"><span>Уровень базы</span><b>30 → 1</b></div>
        <div class="house-kv"><span>Награда</span><b class="accent">+50 <img src="${PATHS.gem}" alt="гемы"></b></div>
        <div class="house-kv"><span>Награда</span><b class="accent">+500 рейтинга</b></div>
        <div class="house-kv"><span>Предметы и ресурсы</span><b>не сбрасываются</b></div>
        <div class="house-kv"><span>Фоны дома</span><b>не сбрасываются</b></div>
        <div class="house-note house-note-bad"><span>После продажи снова понадобится собирать материалы и монеты для улучшений.</span></div>
      </div>
      <footer class="house-modal-actions">
        <button class="house-btn house-btn-danger" onclick="playClick(); sellHouse();">${HOUSE_ICONS.cycle}ПРОДАТЬ И НАЧАТЬ ЗАНОВО</button>
        <button class="house-close-btn" onclick="playClick(); closeHouseResetModal();">ОТМЕНА</button>
      </footer>`;
    modal.style.display='flex';
}
function closeHouseResetModal(){document.getElementById('house-reset-modal')?.style.setProperty('display','none');}
async function sellHouse(){
    if(GameState.houseLevel<30){showNotification('СНАЧАЛА ДОСТИГНИТЕ 30 УРОВНЯ');return;}
    try{
        const data=await gameAction('sellHouse'); updateBalance(); closeHouseResetModal(); renderHouse();
        showNotification(`УБЕЖИЩЕ ПРОДАНО! +${data.result?.gems||50} 💎 +${data.result?.rating||500} РЕЙТИНГА`);
    }catch(e){playError();showNotification(e.message||'Не удалось продать убежище');}
}

// ==================== РЕНДЕР ДОМА ====================

function renderHouse() {
    const container = document.getElementById('house-content');
    if (!container) return;
    
    if (liveIncomeInterval) {
        clearInterval(liveIncomeInterval);
        liveIncomeInterval = null;
    }
    
    const currentHouseData = getHouseLevelData(GameState.houseLevel);
    const pendingIncome = calculateHouseIncome();
    const maxIncome = getMaxIncomeForCurrentLevel();
    const bg = getSelectedBackground();
    const bgCss = bg ? bg.css : 'linear-gradient(180deg, #1a1a2e, #0a0a1a)';
    const bgId = bg?.id || 'day';
    
    container.innerHTML = `
        <div class="house-scene bg-${bgId}" style="background: ${bgCss}; border: 3px solid var(--border-color); border-radius: var(--border-radius); padding: 25px; text-align: center; box-shadow: 0 8px 0 rgba(0,0,0,0.5), 0 0 30px var(--glow-color); position: relative; overflow: hidden; min-height: 400px;">
            <button id="house-ambience-button" type="button" class="house-ambience-button" onclick="cycleHouseAmbience()" aria-label="Громкость звука фона" title="Громкость звука фона"><span aria-hidden="true">🔊</span><b id="house-ambience-level">50%</b></button>
            <div id="bg-effects" style="position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:1;overflow:hidden;"></div>
            
            <div class="house-sprite-wrap">
                <img class="house-sprite" src="${currentHouseData.image || 'png/houses/house_5.png'}" onerror="this.onerror=null;this.src='png/houses/house_5.png';" style="width:220px;height:160px;object-fit:contain;image-rendering:pixelated;" onerror="this.style.display='none';">
            </div>
            
            <div style="position:relative;z-index:10;background:rgba(0,0,0,0.5);border-radius:var(--border-radius);padding:12px;margin-bottom:15px;border:2px solid var(--border-color);">
                <div style="color: var(--border-color); font-size: 14px; margin-bottom:5px;">${escapeHtml(currentHouseData.name)}</div>
                <div style="color: var(--text-secondary); font-size: 9px;">УРОВЕНЬ ${GameState.houseLevel} · ЦИКЛ ${GameState.houseCycle||1}</div>
                <div style="color: var(--text-secondary); font-size: 7px; margin-top:8px; line-height: 1.5;">${escapeHtml(currentHouseData.description || '')}</div>
            </div>
            
            <div style="position:relative;z-index:10;background:rgba(0,0,0,0.5);border-radius:var(--border-radius);padding:12px;margin-bottom:15px;border:2px solid var(--border-color);">
                <div style="display:flex;align-items:center;justify-content:center;gap:8px;margin-bottom:8px;font-size:8px;color:var(--text-primary);">
                    <span>ДОХОД:</span>
                    <img src="${PATHS.coin}" style="width:16px;height:16px;" onerror="this.style.display='none';">
                    <span>${currentHouseData.incomePerMinute || 0}</span>
                    <span style="color:var(--text-secondary);">/ 1 МИН</span>
                </div>
                <div style="display:flex;align-items:center;justify-content:center;gap:8px;font-size:8px;color:var(--text-primary);">
                    <span>НАКОПЛЕНО:</span>
                    <img src="${PATHS.coin}" style="width:16px;height:16px;" onerror="this.style.display='none';">
                    <span id="live-income-display">${pendingIncome}</span>
                </div>
                <div style="display:flex;align-items:center;justify-content:center;gap:8px;margin-top:8px;font-size:7px;color:var(--text-secondary);">
                    <span>МАКС:</span>
                    <img src="${PATHS.coin}" style="width:14px;height:14px;" onerror="this.style.display='none';">
                    <span>${maxIncome}</span>
                </div>
            </div>
            
            <button class="menu-btn" style="position:relative;z-index:10;width:100%; margin: 8px auto; padding: 13px; font-size: 10px; background: linear-gradient(135deg, #4CAF50, #8BC34A);" onclick="playClick(); openHouseIncomeModal();">ДОХОД</button>
            ${GameState.houseLevel < 30 ? `<button class="menu-btn" style="position:relative;z-index:10;width:100%; margin: 8px auto; padding: 13px; font-size: 10px; background: linear-gradient(135deg, #ff9800, #f57c00);" onclick="playClick(); openHouseUpgradeModal();">УЛУЧШЕНИЕ</button>` : `<button class="menu-btn" style="position:relative;z-index:10;width:100%; margin: 8px auto; padding: 13px; font-size: 10px; background: linear-gradient(135deg, #a43b3b, #d05a4a);" onclick="playClick(); openHouseResetModal();">ПРОДАТЬ УБЕЖИЩЕ</button>`}
            <button class="menu-btn" style="position:relative;z-index:10;width:100%; margin: 8px auto; padding: 13px; font-size: 10px; background: linear-gradient(135deg, #2196F3, #1976D2);" onclick="playClick(); openHouseBackgroundModal();">ФОН</button>
        </div>
    `;
    
    addBackgroundEffects(bgId);
    updateHouseAmbienceButton();
    syncHouseAmbience();
    startLiveIncome();
    ensureHouseAnimations();
}

// ==================== АНИМАЦИИ ====================

function ensureHouseAnimations() {
    if (houseAnimationsAdded) return;
    
    const style = document.createElement('style');
    style.id = 'house-animations';
    style.textContent = `
        @keyframes houseFloat {
            0%, 100% { transform: translateY(0); }
            50% { transform: translateY(-10px); }
        }
        @keyframes coinFloatUp {
            0% { transform: translate(0, 0) scale(1); opacity: 1; }
            30% { transform: translate(-20px, -80px) scale(1.2); opacity: 1; }
            70% { transform: translate(50px, -150px) scale(0.8); opacity: 0.7; }
            100% { transform: translate(150px, -220px) scale(0.1); opacity: 0; }
        }
        @keyframes collectFlash {
            0% { opacity: 0; transform: scale(0.5); }
            30% { opacity: 0.8; transform: scale(1.2); }
            100% { opacity: 0; transform: scale(1.8); }
        }
        @keyframes upgradeFlash {
            0% { opacity: 0; }
            15% { opacity: 1; }
            100% { opacity: 0; }
        }
        @keyframes circleFly {
            0% { transform: translate(0, 0) scale(1); opacity: 1; }
            100% { transform: translate(var(--dx), var(--dy)) scale(0); opacity: 0; }
        }
        @keyframes starTwinkle {
            0%, 100% { opacity: 0.2; transform: scale(1); }
            50% { opacity: 1; transform: scale(1.5); }
        }
        @keyframes cloudMove {
            0% { transform: translateX(-100px); }
            100% { transform: translateX(500px); }
        }
        @keyframes shootingStar {
            0% { transform: translate(0,0); opacity: 0; }
            10% { opacity: 1; }
            100% { transform: translate(-150px,150px); opacity: 0; }
        }
        @keyframes rainDrop {
            0% { transform: translateY(0); opacity: 0.5; }
            100% { transform: translateY(400px); opacity: 0; }
        }
        @keyframes lightningFlash {
            0%, 90%, 100% { opacity: 0; }
            92% { opacity: 0.5; }
            94% { opacity: 0; }
            96% { opacity: 0.3; }
            98% { opacity: 0; }
        }
        @keyframes neonLinePulse {
            0%, 100% { opacity: 0.3; }
            50% { opacity: 1; }
        }
        @keyframes neonDot {
            0%, 100% { opacity: 0.3; transform: scale(1); }
            50% { opacity: 1; transform: scale(1.5); }
        }
        @keyframes dustDrift { 0% { transform: translateX(-30px); opacity:0; } 15% { opacity:.45; } 85% { opacity:.45; } 100% { transform: translateX(170px); opacity:0; } }
        @keyframes fireflyMove {
            0%, 100% { transform: translate(0,0); opacity: 0.3; }
            25% { transform: translate(30px,-30px); opacity: 1; }
            50% { transform: translate(-20px,-50px); opacity: 0.6; }
            75% { transform: translate(-40px,-20px); opacity: 0.9; }
        }
    `;
    document.head.appendChild(style);
    houseAnimationsAdded = true;
}

function addBackgroundEffects(bgId) {
    const effectsContainer = document.getElementById('bg-effects');
    if (!effectsContainer) return;
    
    effectsContainer.innerHTML = '';
    const fragment = document.createDocumentFragment();

    const vignette = document.createElement('div');
    vignette.className = 'house-ambient-vignette';
    fragment.appendChild(vignette);

    // Лёгкие CSS-эффекты: без canvas, blur и тяжёлых таймеров.
    if (bgId === 'day') {
        for (let i = 0; i < 8; i++) {
            const cloud = document.createElement('div');
            cloud.className = 'house-static-cloud';
            cloud.style.top = (4 + (i % 3) * 8) + '%';
            cloud.style.left = ((i * 31) % 95) + '%';
            cloud.style.setProperty('--cloud-scale', (0.82 + i * 0.12).toFixed(2));
            fragment.appendChild(cloud);
        }
    } else if (bgId === 'night') {
        for(let i=0;i<3;i++){const shooting=document.createElement('i');shooting.className='house-shooting-star';shooting.style.top=(3+i*7)+'%';shooting.style.left=(18+i*23)+'%';shooting.style.animationDelay=(-i*6)+'s';fragment.appendChild(shooting);}
        const moon = document.createElement('div');
        moon.className = 'house-moon';
        fragment.appendChild(moon);
        for (let i = 0; i < 28; i++) {
            const star = document.createElement('div');
            const size = 2 + Math.random() * 2;
            star.style.cssText = `position:absolute;width:${size}px;height:${size}px;background:#fff;border-radius:50%;top:${Math.random() * 43}%;left:${Math.random() * 100}%;animation:starTwinkle ${2 + Math.random() * 3}s ease-in-out infinite;`;
            fragment.appendChild(star);
        }
    } else if (bgId === 'rain') {
        for (let i = 0; i < 28; i++) {
            const drop = document.createElement('div');
            drop.style.cssText = `position:absolute;width:1px;height:16px;background:rgba(210,230,255,0.5);top:-20px;left:${Math.random() * 100}%;animation:rainDrop ${0.8 + Math.random() * 0.6}s linear infinite;animation-delay:${Math.random()}s;`;
            fragment.appendChild(drop);
        }
        const lightning = document.createElement('div');
        lightning.style.cssText = 'position:absolute;inset:0;background:rgba(190,220,255,.14);opacity:0;animation:lightningFlash 7s ease-in-out infinite;';
        fragment.appendChild(lightning);
    } else if (bgId === 'sunset') {
        for (let i = 0; i < 5; i++) {
            const ember = document.createElement('div');
            ember.className = 'house-ember';
            ember.style.left = (10 + Math.random() * 80) + '%';
            ember.style.top = (55 + Math.random() * 35) + '%';
            ember.style.setProperty('--dx', ((Math.random() - .5) * 80) + 'px');
            ember.style.animationDelay = (-Math.random() * 3) + 's';
            fragment.appendChild(ember);
        }
    } else if (bgId === 'forest') {
        for (let i = 0; i < 28; i++) {
            const firefly = document.createElement('div');
            firefly.className = 'house-firefly';
            firefly.style.left = Math.random() * 100 + '%';
            firefly.style.top = (15 + Math.random() * 70) + '%';
            firefly.style.animationDelay = (-Math.random() * 5) + 's';
            fragment.appendChild(firefly);
        }
    } else if (bgId === 'snow') {
        for (let c=0;c<5;c++){const cloud=document.createElement('div');cloud.className='house-static-cloud';cloud.style.top=(4+c*7)+'%';cloud.style.left=(c*34)+'%';fragment.appendChild(cloud);}
        for (let i = 0; i < 64; i++) {
            const flake = document.createElement('div'); flake.className = 'house-snowflake'; flake.style.left = Math.random() * 100 + '%'; flake.style.top = (-Math.random() * 30) + '%'; flake.style.animationDuration = (3 + Math.random() * 2.8) + 's'; flake.style.animationDelay = (-Math.random() * 5) + 's'; fragment.appendChild(flake);
        }
    } else if (bgId === 'eclipse') {
        for (let i = 0; i < 16; i++) {
            const star=document.createElement('div'); const size=1+Math.random()*2;
            star.style.cssText=`position:absolute;width:${size}px;height:${size}px;background:#fff;border-radius:50%;top:${Math.random()*62}%;left:${Math.random()*100}%;opacity:${0.25+Math.random()*0.55};`; fragment.appendChild(star);
        }
        const moon=document.createElement('div'); moon.className='house-eclipse'; fragment.appendChild(moon);
    } else if (bgId === 'cyberpunk') {
        for (let i = 0; i < 4; i++) {
            const line = document.createElement('div');
            line.className = 'house-pulse-line';
            line.style.width = (15 + Math.random() * 30) + '%';
            line.style.left = Math.random() * 85 + '%';
            line.style.top = (10 + Math.random() * 80) + '%';
            line.style.animationDelay = (-Math.random() * 2.5) + 's';
            fragment.appendChild(line);
        }

    }
    
    if (bgId === 'cyberpunk') {
        const skyline = document.createElement('div');
        skyline.className = 'house-cyber-skyline';
        fragment.appendChild(skyline);
        const towers = [9,20,34,47,61,74,87];
        towers.forEach((x,i) => {
            const tower=document.createElement('div');tower.className='house-cyber-tower';
            tower.style.left=x+'%';tower.style.height=(26+(i*19)%37)+'%';
            tower.style.setProperty('--neon',i%2?'#ff37ba':'#28eaff');
            fragment.appendChild(tower);
        });
        const sign=document.createElement('div');sign.className='house-cyber-sign';sign.textContent='NIGHT CITY';fragment.appendChild(sign);const holo=document.createElement('div');holo.className='house-cyber-holo';holo.textContent='Z // 2077';fragment.appendChild(holo);const antenna=document.createElement('div');antenna.className='house-cyber-antenna';fragment.appendChild(antenna);
    }
    effectsContainer.appendChild(fragment);
}

// ==================== ЖИВОЙ ДОХОД ====================

function startLiveIncome() {
    if (liveIncomeInterval) {
        clearInterval(liveIncomeInterval);
        liveIncomeInterval = null;
    }
    
    liveIncomeInterval = setInterval(() => {
        const display = document.getElementById('live-income-display');
        if (display) {
            display.textContent = calculateHouseIncome();
        } else {
            clearInterval(liveIncomeInterval);
            liveIncomeInterval = null;
        }
    }, 1000);
}

console.log('[HOUSE] Модуль дома загружен');
// Global ambience. Browser autoplay requires a user gesture; resume on the first gesture.
const houseAmbience={level:50,scene:null,players:[],timer:null,fade:null,generation:0,unlocked:false};
const HOUSE_TRACKS={day:'day',sunset:'sunset',night:'night',rain:'rain',cyberpunk:'cyberpunk',forest:'forest',eclipse:'night',snow:'snow'};
function updateHouseAmbienceButton(){
 const button=document.getElementById('house-ambience-button'),label=document.getElementById('house-ambience-level');
 if(label)label.textContent=houseAmbience.level+'%';
 if(button){const icon=button.querySelector('span');if(icon)icon.textContent=houseAmbience.level?'🔊':'🔇';button.setAttribute('aria-label','Фоновый звук: '+houseAmbience.level+'%. Изменить громкость');}
}
function clearHouseTimer(){if(houseAmbience.timer!==null){clearTimeout(houseAmbience.timer);houseAmbience.timer=null;}}
function disposeHousePlayer(p){p.audio.pause();p.audio.removeAttribute('src');p.audio.load();}
function animateHouseVolumes(duration,targets,done){
 if(houseAmbience.fade!==null)cancelAnimationFrame(houseAmbience.fade);
 houseAmbience.fade=null;
 const begin=performance.now(),entries=targets.map(([p,to])=>({p,from:p.audio.volume,to}));
 const frame=now=>{const t=Math.min(1,(now-begin)/duration),eased=t*t*(3-2*t);
  entries.forEach(({p,from,to})=>{if(houseAmbience.players.includes(p))p.audio.volume=Math.max(0,Math.min(1,from+(to-from)*eased));});
  if(t<1)houseAmbience.fade=requestAnimationFrame(frame);else{houseAmbience.fade=null;done?.();}
 };houseAmbience.fade=requestAnimationFrame(frame);
}
function stopHouseAmbience(){++houseAmbience.generation;clearHouseTimer();if(houseAmbience.fade!==null)cancelAnimationFrame(houseAmbience.fade);houseAmbience.fade=null;houseAmbience.players.splice(0).forEach(disposeHousePlayer);houseAmbience.scene=null;}
function createHousePlayer(track){const audio=new Audio('audio/ambience/'+track+'.mp3');audio.preload='auto';audio.volume=0;return {audio,track};}
function scheduleHouseLoop(p,generation){
 clearHouseTimer();const remaining=Number.isFinite(p.audio.duration)&&p.audio.duration>0?Math.max(100,(p.audio.duration-p.audio.currentTime-2)*1000):28000;
 houseAmbience.timer=setTimeout(()=>{if(generation===houseAmbience.generation&&!document.hidden)startHouseTrack(p.track,generation);},remaining);
}
function startHouseTrack(track,generation){
 if(generation!==houseAmbience.generation||!houseAmbience.unlocked||document.hidden)return;
 const incoming=createHousePlayer(track),outgoing=houseAmbience.players.slice();houseAmbience.players.push(incoming);
 incoming.audio.play().then(()=>{
  if(generation!==houseAmbience.generation){houseAmbience.players=houseAmbience.players.filter(x=>x!==incoming);disposeHousePlayer(incoming);return;}
  animateHouseVolumes(2000,[...outgoing.map(p=>[p,0]),[incoming,houseAmbience.level/100]],()=>{outgoing.forEach(p=>{disposeHousePlayer(p);houseAmbience.players=houseAmbience.players.filter(x=>x!==p);});});
  scheduleHouseLoop(incoming,generation);
 }).catch(()=>{houseAmbience.players=houseAmbience.players.filter(x=>x!==incoming);disposeHousePlayer(incoming);});
}
function syncHouseAmbience(){
 if(!houseAmbience.unlocked||document.hidden)return;
 const scene=typeof getSelectedBackground==='function'?(getSelectedBackground()?.id||'day'):'day',track=HOUSE_TRACKS[scene]||'day';
 if(houseAmbience.scene===track&&houseAmbience.players.length)return;
 houseAmbience.scene=track;++houseAmbience.generation;clearHouseTimer();startHouseTrack(track,houseAmbience.generation);
}
function cycleHouseAmbience(){
 const next={100:0,0:25,25:50,50:75,75:100};houseAmbience.level=next[houseAmbience.level]??50;
 houseAmbience.unlocked=true;updateHouseAmbienceButton();
 if(houseAmbience.players.length)animateHouseVolumes(180,houseAmbience.players.map(p=>[p,houseAmbience.level/100]));else syncHouseAmbience();
}
function unlockHouseAudio(){if(!houseAmbience.unlocked)houseAmbience.unlocked=true;syncHouseAmbience();}
// The browser cannot play audible media before a permitted user gesture. Listen for both touch and keyboard.
document.addEventListener('pointerdown',unlockHouseAudio,{capture:true});
document.addEventListener('keydown',unlockHouseAudio,{capture:true});
document.addEventListener('visibilitychange',()=>{if(document.hidden)stopHouseAmbience();else syncHouseAmbience();});
