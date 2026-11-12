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
        modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.9);display:none;align-items:center;justify-content:center;z-index:1400;';
        modal.innerHTML = `<div id="house-background-content" style="background:var(--bg-primary);border:3px solid var(--border-color);border-radius:15px;padding:20px;width:95%;max-width:450px;max-height:85%;overflow-y:auto;text-align:center;box-shadow:0 0 40px var(--glow-color);position:relative;"></div>`;
        app.appendChild(modal);
    }
    
    const content = document.getElementById('house-background-content');
    if (!content) return;
    
    let backgroundsHTML = '<div style="font-size:16px;margin-bottom:10px;color:var(--border-color);">ФОН ДОМА</div>';
    backgroundsHTML += '<div style="font-size:8px;color:var(--text-secondary);margin-bottom:15px;">СМЕНА ФОНА РАЗ В 5 СЕКУНД</div>';
    backgroundsHTML += '<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:12px;margin-bottom:20px;">';
    
    if (HOUSE_DATABASE.backgrounds) {
        HOUSE_DATABASE.backgrounds.forEach(bg => {
            const isOwned = GameState.ownedHouseBackgrounds.includes(bg.id);
            const isSelected = GameState.selectedHouseBackground === bg.id;
            const currencyIcon = bg.currency === 'gems' ? PATHS.gem : PATHS.coin;
            
            backgroundsHTML += `
                <div onclick="playClick(); selectHouseBackground('${bg.id}');" style="cursor:pointer;border:2px solid ${isSelected ? 'var(--border-color)' : '#444'};border-radius:10px;padding:12px;background:${bg.css};min-height:100px;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;position:relative;overflow:hidden;">
                    <div style="position:relative;color:#fff;font-size:10px;text-shadow:1px 1px 3px #000;margin-bottom:5px;">${escapeHtml(bg.name)}</div>
                    ${!isOwned ? `<div style="position:relative;display:flex;align-items:center;gap:4px;color:#ffd700;font-size:9px;text-shadow:1px 1px 2px #000;"><img src="${currencyIcon}" style="width:14px;height:14px;" onerror="this.style.display='none';"> ${bg.price}</div>` : ''}
                    ${isSelected ? '<div style="position:absolute;top:8px;right:8px;color:#4CAF50;font-size:14px;">✓</div>' : ''}
                </div>
            `;
        });
    }
    
    backgroundsHTML += '</div>';
    backgroundsHTML += '<button class="house-close-btn" style="padding:14px;font-size:11px;" onclick="playClick(); closeHouseBackgroundModal();">ЗАКРЫТЬ</button>';
    
    content.innerHTML = backgroundsHTML;
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
    
    content.innerHTML = `
        <div class="house-modal-title" style="font-size:18px;">ДОХОД ДОМА</div>
        <div style="color: var(--text-primary); font-size: 14px; margin-bottom: 10px;">${escapeHtml(currentHouseData.name)}</div>
        <div style="color: var(--text-secondary); font-size: 8px; margin-bottom: 15px; line-height: 1.5;">${escapeHtml(currentHouseData.description || '')}</div>
        <div style="background:rgba(0,0,0,0.3);border-radius:10px;padding:20px;margin-bottom:20px;border:1px solid var(--border-color);">
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:15px;font-size:11px;color:var(--text-primary);">
                <span>ДОХОД:</span>
                <img src="${PATHS.coin}" style="width:20px;height:20px;" onerror="this.style.display='none';">
                <span>${currentHouseData.incomePerMinute || 0}</span>
                <span style="color:var(--text-secondary);">/ 1 МИН</span>
            </div>
            <div style="display:flex;align-items:center;gap:10px;font-size:11px;color:var(--text-primary);">
                <span>НАКОПЛЕНО:</span>
                <img src="${PATHS.coin}" style="width:20px;height:20px;" onerror="this.style.display='none';">
                <span>${pendingIncome}</span>
            </div>
            <div style="display:flex;align-items:center;gap:10px;margin-top:10px;font-size:11px;color:var(--text-secondary);">
                <span>МАКСИМУМ (${maxHours} ЧАСА):</span>
                <img src="${PATHS.coin}" style="width:20px;height:20px;" onerror="this.style.display='none';">
                <span>${maxIncome}</span>
            </div>
        </div>
        <button class="menu-btn" style="width:100%; margin: 10px auto; padding: 18px; font-size: 13px; background: linear-gradient(135deg, #4CAF50, #8BC34A);" onclick="playClick(); collectHouseIncome(); closeHouseIncomeModal();">ЗАБРАТЬ ${pendingIncome}</button>
        <button class="house-close-btn" onclick="playClick(); closeHouseIncomeModal();">ЗАКРЫТЬ</button>
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
            <div class="house-modal-title" style="font-size:18px;">УЛУЧШЕНИЕ ДОМА</div>
            <div style="color: #4CAF50; font-size: 14px; margin-bottom: 15px;">МАКСИМАЛЬНЫЙ УРОВЕНЬ!</div>
            <button class="house-close-btn" onclick="playClick(); closeHouseUpgradeModal();">ЗАКРЫТЬ</button>
        `;
        modal.classList.add('show');
        return;
    }
    
    const costCoins = currentHouseData.upgradeCostCoins || 0;
    const costGems = currentHouseData.upgradeCostGems || 0;
    const requiredItems = currentHouseData.requiredItems || [];
    
    let requirementsHTML = '<div style="background:rgba(0,0,0,0.3);border-radius:10px;padding:20px;margin-bottom:20px;border:1px solid var(--border-color);">';
    requirementsHTML += '<div style="color:var(--border-color);font-size:11px;margin-bottom:15px;text-align:center;">ТРЕБУЕТСЯ</div>';
    
    if (costCoins > 0) {
        const hasCoins = totalCoinsAvailable >= costCoins;
        requirementsHTML += `
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;color:${hasCoins ? '#4CAF50' : '#ff6b6b'};font-size:10px;border:2px solid var(--border-color);border-radius:8px;padding:10px;background:rgba(0,0,0,0.2);">
                <img src="${PATHS.coin}" style="width:30px;height:30px;" onerror="this.style.display='none';">
                <span>${costCoins}</span>
                <span style="margin-left:auto;">${GameState.coins}${pendingIncome > 0 ? ' + ' + pendingIncome : ''}/${costCoins}</span>
            </div>
        `;
    }
    
    if (costGems > 0) {
        const hasGems = GameState.gems >= costGems;
        requirementsHTML += `
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;color:${hasGems ? '#4CAF50' : '#ff6b6b'};font-size:10px;border:2px solid #00bcd4;border-radius:8px;padding:10px;background:rgba(0,0,0,0.2);">
                <img src="${PATHS.gem}" style="width:30px;height:30px;" onerror="this.style.display='none';">
                <span>${costGems}</span>
                <span style="margin-left:auto;">${GameState.gems}/${costGems}</span>
            </div>
        `;
    }
    
    if (requiredItems.length > 0) {
        requirementsHTML += '<div style="color:var(--border-color);font-size:10px;margin:15px 0 10px;text-align:center;">ПРЕДМЕТЫ</div>';
        requiredItems.forEach(req => {
            const itemData = getItemById(req.itemId);
            const countInInventory = GameState.inventory.filter(item => item.id === req.itemId && item.tier === req.tier).length;
            const isEnough = countInInventory >= req.count;
            const color = isEnough ? '#4CAF50' : '#ff6b6b';
            requirementsHTML += `
                <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;color:${color};font-size:9px;border:2px solid ${tierColors[req.tier]};border-radius:8px;padding:10px;background:rgba(0,0,0,0.2);">
                    ${itemSprite(itemData?.image, `house-required-item tier-${req.tier}`)}
                    <div style="flex:1;text-align:left;">
                        <div>${escapeHtml(itemData ? itemData.name : 'Предмет')}</div>
                        <div style="font-size:7px;color:${tierColors[req.tier]};margin-top:3px;">${tierNames[req.tier]}</div>
                    </div>
                    <span>${countInInventory}/${req.count}</span>
                </div>
            `;
        });
    }
    requirementsHTML += '</div>';
    
    let autoCollectHTML = '';
    if (pendingIncome > 0) {
        autoCollectHTML = `
            <div style="background:rgba(76,175,80,0.2);border:1px solid #4CAF50;border-radius:8px;padding:10px;margin-bottom:15px;font-size:8px;color:#4CAF50;">
                💰 ПРИ УЛУЧШЕНИИ БУДЕТ СОБРАН ДОХОД: ${pendingIncome} МОНЕТ
            </div>
        `;
    }
    
    const nextHouseData = getHouseLevelData(GameState.houseLevel + 1);
    
    content.innerHTML = `
        <div class="house-modal-title" style="font-size:18px;">УЛУЧШЕНИЕ ДОМА</div>
        <div style="color: var(--text-primary); font-size: 12px; margin-bottom: 10px;">${escapeHtml(currentHouseData.name)} → ${escapeHtml(nextHouseData.name)}</div>
        <div style="color: var(--text-secondary); font-size: 8px; margin-bottom: 20px; line-height: 1.5;">${escapeHtml(nextHouseData.description || '')}</div>
        ${autoCollectHTML}
        ${requirementsHTML}
        <button class="menu-btn" style="width:100%; margin: 15px auto; padding: 18px; font-size: 13px;" onclick="playClick(); upgradeHouse(); closeHouseUpgradeModal();">УЛУЧШИТЬ</button>
        <button class="house-close-btn" onclick="playClick(); closeHouseUpgradeModal();">ЗАКРЫТЬ</button>
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
        modal=document.createElement('div'); modal.id='house-reset-modal';
        modal.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.9);display:none;align-items:center;justify-content:center;z-index:1500;padding:16px;box-sizing:border-box;';
        modal.innerHTML='<div id="house-reset-content" style="width:95%;max-width:430px;background:var(--bg-primary);border:3px solid #d6a84f;border-radius:12px;padding:20px;text-align:center;box-shadow:0 0 35px rgba(214,168,79,.25);"></div>';
        app.appendChild(modal);
    }
    const c=document.getElementById('house-reset-content');
    c.innerHTML=`
      <div style="font-size:18px;color:var(--border-color);margin-bottom:12px;">ПРОДАТЬ УБЕЖИЩЕ?</div>
      <div style="font-size:10px;color:var(--text-primary);line-height:1.8;margin-bottom:14px;">Ваше убежище достигло 30 уровня. Его можно продать и начать развитие заново.</div>
      <div style="background:rgba(0,0,0,.3);border:1px solid var(--border-color);border-radius:8px;padding:12px;margin-bottom:14px;text-align:left;font-size:9px;line-height:1.9;">
        <div>• Уровень базы: <b>30 → 1</b></div>
        <div>• Награда: <b style="color:#ffd86a;">+50 💎</b></div>
        <div>• Награда: <b style="color:#ffd86a;">+500 рейтинга</b></div>
        <div>• Предметы и другие ресурсы <b>не сбрасываются</b></div>
        <div>• Фоны дома <b>не сбрасываются</b></div>
      </div>
      <div style="font-size:8px;color:#ff8b8b;line-height:1.6;margin-bottom:14px;">После продажи снова понадобится собирать материалы и монеты для улучшений.</div>
      <button class="menu-btn" style="width:100%;padding:15px;font-size:11px;background:linear-gradient(135deg,#b33,#e05252);" onclick="playClick(); sellHouse();">ПРОДАТЬ И НАЧАТЬ ЗАНОВО</button>
      <button class="house-close-btn" style="margin-top:10px;" onclick="playClick(); closeHouseResetModal();">ОТМЕНА</button>`;
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
