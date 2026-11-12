// js/cases.js — СИСТЕМА КЕЙСОВ

let isFiltering = false;
let currentCaseDetailId = null;
let favoriteClickUntil = 0;
let selectedOpenQuantity = 1;
let caseSearchText = '';
let caseSortMode = 'progression';
let currentRouletteVariants = [];
const ROULETTE_TARGET_INDEX = 42;
const ROULETTE_TRAILING_CARDS = 2;

// ==================== ФИЛЬТРАЦИЯ ====================

function filterCases(category) {
    if (isFiltering || currentCaseFilter === category) return;
    
    isFiltering = true;
    currentCaseFilter = category;
    
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.filter === category);
    });
    
    renderCases();
    
    setTimeout(() => {
        isFiltering = false;
    }, 200);
}

// ==================== ВИД СПИСКА КЕЙСОВ ====================
function renderCaseListView() {
    const panel = document.getElementById('panel-shop');
    if (!panel) return;
    currentCaseDetailId = null;
    currentRouletteCase = null;
    currentRouletteVariants = [];
    currentRouletteResult = null;
    isSpinning = false;
    document.getElementById('roulette-overlay')?.classList.remove('show');
    document.getElementById('roulette-container')?.classList.remove('is-spinning');
    document.getElementById('result-overlay')?.classList.remove('show');
    panel.dataset.view = 'list';
    panel.innerHTML = `
        <div class="case-list-heading"><h3>ВЫБЕРИТЕ КЕЙС</h3><button type="button" class="case-history-open" onclick="playClick();openCaseHistory()">ИСТОРИЯ ОТКРЫТИЙ</button></div>
        <div class="case-browser-tools"><input id="case-search" type="search" autocomplete="off" maxlength="40" placeholder="НАЙТИ КЕЙС…" value="${escapeHtml(caseSearchText)}" oninput="setCaseSearch(this.value)"><select id="case-sort" aria-label="Сортировка кейсов" onchange="setCaseSort(this.value)"><option value="progression" ${caseSortMode==='progression'?'selected':''}>ПО ПРОГРЕССУ</option><option value="price-asc" ${caseSortMode==='price-asc'?'selected':''}>ЦЕНА ↑</option><option value="price-desc" ${caseSortMode==='price-desc'?'selected':''}>ЦЕНА ↓</option></select></div>
        <div id="cases-filter"></div>
        <div id="cases-grid"></div>`;
    renderCaseFilters();
    renderCases();
    panel.scrollTop = 0;
}

// Фильтры кейсов настраиваются в public/data/cases.json.
function renderCaseFilters(){
 const wrap=document.getElementById('cases-filter'); if(!wrap)return;
 const baseDefs=Array.isArray(CASES_DATABASE?.filterCategories)?CASES_DATABASE.filterCategories:[]; const defs=[{id:'favorites',label:'ИЗБРАННОЕ'},...baseDefs];
 if(!defs.some(f=>String(f?.id)===String(currentCaseFilter))) currentCaseFilter=String(defs[0]?.id||'all');
 wrap.innerHTML=defs.map(f=>{const id=String(f?.id||'').trim();if(!id)return '';const label=escapeHtml(String(f?.label||id).slice(0,24));return `<button class="filter-btn ${String(currentCaseFilter)===id?'active':''}" data-filter="${escapeHtml(id)}" onclick="playClick();filterCases('${id.replace(/'/g,"\'")}');">${label}</button>`;}).join('');
}

// ==================== РЕНДЕР КЕЙСОВ ====================

function setCaseSearch(value) {
    caseSearchText = String(value || '').slice(0, 40);
    renderCases();
}

function setCaseSort(value) {
    const allowed = ['progression', 'price-asc', 'price-desc'];
    caseSortMode = allowed.includes(String(value)) ? String(value) : 'progression';
    renderCases();
}

function favoriteStarSvg(){return '<svg class="favorite-star-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.6l2.86 5.8 6.4.93-4.63 4.51 1.09 6.37L12 17.2l-5.72 3.01 1.09-6.37L2.74 9.33l6.4-.93L12 2.6z"/></svg>'; }

function getFavoriteCaseIds(){ try{return JSON.parse(localStorage.getItem('zombixFavoriteCasesV38')||'[]').map(Number).filter(Number.isFinite);}catch{return [];} }
function isFavoriteCase(id){return getFavoriteCaseIds().includes(Number(id));}
function toggleFavoriteCase(id,event){
 if(event){event.stopPropagation();event.preventDefault();}
 const now=Date.now();
 if(now<favoriteClickUntil){showNotification('ПОДОЖДИТЕ 3 СЕКУНДЫ');return;}
 favoriteClickUntil=now+3000;
 const list=getFavoriteCaseIds(), n=Number(id);
 const next=list.includes(n)?list.filter(x=>x!==n):[...list,n];
 try{localStorage.setItem('zombixFavoriteCasesV38',JSON.stringify(next.slice(0,30)));}catch{}
 const detailButton=document.querySelector('.case-detail-favorite');
 if(detailButton && Number(detailButton.dataset.caseId)===n){
   const active=next.includes(n); detailButton.classList.toggle('active',active);
   detailButton.setAttribute('aria-pressed',String(active));
   detailButton.setAttribute('aria-label',active?'Убрать из избранного':'Добавить в избранное');
 }
 if(document.getElementById('cases-grid'))renderCases();
 playClick();
}

function renderCases() { 
    const grid = document.getElementById('cases-grid'); 
    if (!grid) return;
    
    grid.innerHTML = ''; 
    
    const allCases = Array.isArray(CASES_DATABASE?.cases) ? CASES_DATABASE.cases : [];
    const search = caseSearchText.trim().toLocaleLowerCase('ru-RU');
    const filteredCases = allCases.filter(caseData => {
        if (search && !String(caseData.name || '').toLocaleLowerCase('ru-RU').includes(search)) return false;
        if (currentCaseFilter === 'all') return true;
        if (currentCaseFilter === 'favorites') return isFavoriteCase(caseData.id);
        return String(caseData.category || '') === String(currentCaseFilter);
    });
    const priceOf = item => Number(item.price || 0) * (item.currency === 'gems' ? 15000 : 1);
    filteredCases.sort((a,b)=> {
        if (a.isAd !== b.isAd) return a.isAd ? 1 : -1;
        if (caseSortMode === 'price-asc') return priceOf(a)-priceOf(b) || Number(a.id)-Number(b.id);
        if (caseSortMode === 'price-desc') return priceOf(b)-priceOf(a) || Number(a.id)-Number(b.id);
        return Number(a.requiredLevel||0)-Number(b.requiredLevel||0) || Number(a.id)-Number(b.id);
    });
    if (filteredCases.length === 0) {
        grid.innerHTML = '<p style="color:var(--text-secondary);text-align:center;font-size:8px;">НЕТ КЕЙСОВ</p>';
        return;
    }
    
    const fragment = document.createDocumentFragment();
    
    filteredCases.forEach(caseData => { 
        const isLocked = caseData.requiredLevel && GameState.level < caseData.requiredLevel; 
        const card = document.createElement('div'); 
        card.className = 'case-card'; 
        
        if (caseData.isAd) card.classList.add('ad-case'); 
        if (caseData.currency === 'gems') card.classList.add('gem-case'); 
        if (isLocked) card.classList.add('locked'); 
        
        let borderColor = caseData.borderColor || '#ffd700'; 
        if (isLocked) borderColor = '#666'; 
        
        card.style.borderColor = borderColor; 
        const darkBg = darkenColor(borderColor, 0.25); 
        card.style.background = `linear-gradient(145deg, ${darkBg}, ${darkenColor(borderColor, 0.15)})`; 
        card.style.boxShadow = `0 6px 0 rgba(0,0,0,0.5), 0 0 25px ${hexToRgba(borderColor, 0.5)}, inset 0 0 20px rgba(0,0,0,0.3)`; 
        
        const priceDisplay = caseData.isAd ? 'БЕСПЛАТНО' : ''; 
        const currencyIcon = caseData.currency === 'gems' ? PATHS.gem : PATHS.coin; 
        
        let lockLabel = ''; 
        if (isLocked) {
            lockLabel = `<div class="case-lock-label"><span class="pixel-lock-icon" aria-hidden="true"></span> ДОСТУПНО С ${caseData.requiredLevel} УРОВНЯ</div>`; 
        }
        
        card.innerHTML = `
            <img class="case-icon" src="${caseData.image}" loading="eager" decoding="async" alt="${escapeHtml(caseData.name)}" onerror="this.style.display='none';">
            <div class="case-name">${escapeHtml(caseData.name)}</div>
            ${priceDisplay ? 
                `<div class="case-price"><span class="case-price-text">${priceDisplay}</span></div>` : 
                `<div class="case-price"><img class="currency-icon" src="${currencyIcon}" onerror="this.style.display='none';"><span class="case-price-text ${caseData.currency === 'gems' ? 'gem' : ''}">${caseData.price}</span></div>`
            }
            ${caseData.isAd && !isLocked ? '<div class="case-ad-label">ЗА РЕКЛАМУ</div>' : ''}
            ${lockLabel}
        `; 
        
        card.onclick = () => { 
            playClick(); 
            showCaseDetail(caseData); 
        }; 
        
        fragment.appendChild(card); 
    }); 
    
    grid.appendChild(fragment);
}

// ==================== УТИЛИТЫ ЦВЕТА ====================

function hexToRgba(hex, alpha) { 
    const r = parseInt(hex.slice(1, 3), 16); 
    const g = parseInt(hex.slice(3, 5), 16); 
    const b = parseInt(hex.slice(5, 7), 16); 
    return `rgba(${r},${g},${b},${alpha})`; 
}

function darkenColor(hex, factor) { 
    const r = Math.floor(parseInt(hex.slice(1, 3), 16) * factor); 
    const g = Math.floor(parseInt(hex.slice(3, 5), 16) * factor); 
    const b = Math.floor(parseInt(hex.slice(5, 7), 16) * factor); 
    return `rgb(${r},${g},${b})`; 
}

// ==================== ДЕТАЛИ КЕЙСА ====================
// Цвет рамки изображения кейса: визуально соответствует его редкости.
function getCaseFrameColor(caseData){
    const c=String(caseData?.borderColor||'').toLowerCase();
    const map={'#ffffff':'#d7dce2','#4caf50':tierColors[2],'#2196f3':tierColors[3],'#9c27b0':tierColors[4],'#ff6d00':tierColors[5],'#ffd700':'#ffbf32','#ffaa00':tierColors[4],'#e53935':tierColors[5]};
    return map[c]||c||tierColors[1];
}


function showCaseDetail(caseData) { 
    if (!caseData || !Number.isFinite(Number(caseData.id))) return;
    currentCaseDetailId = Number(caseData.id);
    const detailPanel = document.getElementById('panel-shop');
    if (!detailPanel) return;

    // Это дочерний экран вкладки «Кейсы», а не отдельная вкладка.
    document.querySelectorAll('.content-panel').forEach(panel => {
        const active = panel === detailPanel;
        panel.classList.toggle('active', active);
        panel.classList.remove('slide-left', 'slide-right');
        panel.style.setProperty('display', active ? 'block' : 'none', 'important');
        panel.style.setProperty('opacity', active ? '1' : '0', 'important');
        panel.style.setProperty('visibility', active ? 'visible' : 'hidden', 'important');
        panel.style.setProperty('pointer-events', active ? 'auto' : 'none', 'important');
        panel.style.zIndex = active ? '20' : '1';
    });

    detailPanel.dataset.view = 'detail';
    currentTabIndex = tabOrder.indexOf('shop');
    document.querySelectorAll('.tab').forEach(el => el.classList.toggle('active', el.id === 'tab-shop'));
    detailPanel.scrollTop = 0;
    
    const isLocked = caseData.requiredLevel && GameState.level < caseData.requiredLevel; 
    const dropTable = getDropTable(caseData.id);
    
    let itemsHTML = '<div class="case-drop-grid">';
    const totalChance = Math.max(1, dropTable.reduce((a,d)=>a+Number(d.chance||0),0));
    dropTable.forEach(drop => {
        const item = getItemById(drop.itemId);
        if (!item) return;
        const tier = Number(drop.tier)||1;
        const tierColor = tierColors[tier] || '#fff';
        const chance = ((Number(drop.chance||0) / totalChance) * 100).toFixed(2);
        itemsHTML += `
            <button class="case-drop-item tier-${tier}" type="button" onclick="playClick(); showItemInfo(${item.id}, false);" style="--drop-tier:${tierColor};">
                <span class="case-drop-image">${itemSprite(item.image, 'case-drop-atlas')}</span>
                <span class="case-drop-chance">${chance}%</span>
            </button>
        `;
    });
    itemsHTML += '</div>';

    const currencyIcon = caseData.currency === 'gems' ? PATHS.gem : PATHS.coin;
    const priceDisplay = caseData.isAd ? 'РЕКЛАМА' : `<img src="${currencyIcon}" style="width:16px;height:16px;vertical-align:middle;" onerror="this.style.display='none';"> ${caseData.price}`; 
    let borderColor = isLocked ? '#666' : (caseData.borderColor || '#ffd700');
    const caseFrameColor = isLocked ? '#666' : getCaseFrameColor(caseData); 
    
    const expRange = Array.isArray(caseData.exp) ? `${Math.min(...caseData.exp)}–${Math.max(...caseData.exp)}` : String(caseData.exp||20);
    const ratingRange = Array.isArray(caseData.rating) ? `${Math.min(...caseData.rating)}–${Math.max(...caseData.rating)}` : String(caseData.rating||1);
    const rewardHTML = `<div class="case-reward-strip"><div><span>ОПЫТ</span><b>${escapeHtml(expRange)}</b></div><div><span>РЕЙТИНГ</span><b>${escapeHtml(ratingRange)}</b></div></div>`;
    let buttonHTML = ''; 
    if (isLocked) {
        buttonHTML = `
            <div style="color:#ff9800;font-size:9px;padding:15px;border:2px solid #ff9800;border-radius:8px;margin-bottom:20px;">
                <span class="pixel-lock-icon" aria-hidden="true"></span> ДОСТУПНО С ${caseData.requiredLevel} УРОВНЯ<br>
                <span style="font-size:7px;color:#aaa;">ВАШ УРОВЕНЬ: ${GameState.level}</span>
            </div>
        `; 
    } else {
        buttonHTML = `
            <button onclick="playClick(); openCasePreview(${caseData.id});" class="case-detail-open">
                ${caseData.isAd ? 'СМОТРЕТЬ РЕКЛАМУ' : 'ОТКРЫТЬ'}
            </button>
        `; 
    }
    
    detailPanel.innerHTML = `
        <div class="case-detail-toolbar"><button class="case-detail-top-back" type="button" onclick="playClick(); backToCaseList();">← К КЕЙСАМ</button><button class="case-detail-favorite ${isFavoriteCase(caseData.id)?'active':''}" data-case-id="${Number(caseData.id)}" type="button" aria-label="${isFavoriteCase(caseData.id)?'Убрать из избранного':'Добавить в избранное'}" aria-pressed="${isFavoriteCase(caseData.id)}" onclick="toggleFavoriteCase(${Number(caseData.id)},event)">${favoriteStarSvg()}</button></div>
        <div class="case-detail-main">
            <div style="text-align:center;">
                <div class="case-detail-image-frame" style="display:inline-block;border:3px solid ${caseFrameColor};padding:10px;border-radius:var(--border-radius);background:rgba(0,0,0,0.3);box-shadow:0 0 14px ${hexToRgba(caseFrameColor,0.38)},inset 0 0 10px ${hexToRgba(caseFrameColor,0.12)};">
                    <img src="${caseData.image}" style="width:80px;height:80px;object-fit:contain;" onerror="this.style.display='none';">
                </div>
                <div style="color:var(--text-primary);font-size:14px;margin-top:10px;">${escapeHtml(caseData.name)}</div>
                <div style="color:${caseData.currency === 'gems' ? '#00bcd4' : 'var(--border-color)'};font-size:12px;margin:10px 0;">${priceDisplay}</div>
                ${buttonHTML}
                ${rewardHTML}
                <div class="case-drop-title"><span>ВОЗМОЖНЫЕ ПРЕДМЕТЫ</span></div>
                ${itemsHTML}
            </div>
        </div>
    `; 
}

// ==================== ОТКРЫТИЕ КЕЙСА ====================

function backToCaseList() {
    const panel = document.getElementById('panel-shop');
    if (panel) {
        panel.classList.add('active');
        panel.style.setProperty('display','block','important');
        panel.style.setProperty('visibility','visible','important');
        panel.style.setProperty('pointer-events','auto','important');
    }
    document.querySelectorAll('.content-panel').forEach(p => {
        if (p.id !== 'panel-shop') { p.classList.remove('active'); p.style.setProperty('display','none','important'); p.style.setProperty('pointer-events','none','important'); }
    });
    document.querySelectorAll('.tab').forEach(el => el.classList.toggle('active', el.id === 'tab-shop'));
    currentTabIndex = tabOrder.indexOf('shop');
    renderCaseListView();
}


function openCasePreview(caseId) { 
    const caseData = getCaseById(caseId); 
    if (!caseData) { 
        playError(); 
        return; 
    } 
    
    if (caseData.requiredLevel && GameState.level < caseData.requiredLevel) { 
        playError(); 
        showNotification('НЕДОСТАТОЧНЫЙ УРОВЕНЬ!'); 
        return; 
    } 
    
    if (caseData.isAd) { showAdRewardGate(() => showRoulette(caseData)); return; }
    
    if (caseData.currency === 'gems') { 
        if (GameState.gems < caseData.price) { 
            playError(); 
            showNotification('НЕДОСТАТОЧНО ГЕМОВ!'); 
            return; 
        } 
    } else { 
        if (GameState.coins < caseData.price) { 
            playError(); 
            showNotification('НЕДОСТАТОЧНО МОНЕТ!'); 
            return; 
        } 
    } 
    
    showRoulette(caseData); 
}

// ==================== ИМИТАЦИЯ РЕКЛАМНОЙ НАГРАДЫ ====================
let adRewardTimer = null;
let adRewardSeconds = 0;
let adRewardAction = null;

function showAdRewardGate(action) {
    const overlay = document.getElementById('ad-reward-overlay');
    const timer = document.getElementById('ad-reward-timer');
    const close = document.getElementById('ad-reward-close');
    if (!overlay || !timer || !close) { if (typeof action === 'function') action(); return; }
    clearInterval(adRewardTimer);
    adRewardAction = action;
    adRewardSeconds = 5 + Math.floor(Math.random() * 11);
    timer.textContent = adRewardSeconds;
    close.disabled = true;
    close.classList.remove('ready');
    close.innerHTML = '<span class="pixel-close-icon" aria-hidden="true"></span>';
    overlay.classList.add('show');
    overlay.setAttribute('aria-hidden','false');
    adRewardTimer = setInterval(() => {
        adRewardSeconds--;
        timer.textContent = Math.max(0, adRewardSeconds);
        if (adRewardSeconds <= 0) {
            clearInterval(adRewardTimer);
            adRewardTimer = null;
            close.disabled = false;
            close.classList.add('ready');
            close.innerHTML = '<span class="pixel-close-icon" aria-hidden="true"></span> ПРОДОЛЖИТЬ';
        }
    }, 1000);
}

function closeAdRewardGate() {
    const overlay = document.getElementById('ad-reward-overlay');
    const close = document.getElementById('ad-reward-close');
    if (!overlay || !close || close.disabled) return;
    clearInterval(adRewardTimer);
    adRewardTimer = null;
    overlay.classList.remove('show');
    overlay.setAttribute('aria-hidden','true');
    const action = adRewardAction;
    adRewardAction = null;
    if (typeof action === 'function') action();
}

function bindAdRewardGate() {
    const close = document.getElementById('ad-reward-close');
    const overlay = document.getElementById('ad-reward-overlay');
    if (!close || close.dataset.bound) return;
    close.dataset.bound = '1';
    close.addEventListener('click', () => { if (!close.disabled) { try { playClick(); } catch(_){} closeAdRewardGate(); } });
}

// ==================== РУЛЕТКА ====================

function setOpenQuantity(quantity) {
    const allowed = [1, 3, 5, 10];
    const next = Number(quantity);
    if (!allowed.includes(next) || currentRouletteCase?.isAd || isSpinning) return;
    selectedOpenQuantity = next;
    renderRouletteLanes(selectedOpenQuantity);
    updateOpeningButtons();
}

function updateOpeningButtons() {
    const caseData = currentRouletteCase;
    if (!caseData) return;
    const count = caseData.isAd ? 1 : selectedOpenQuantity;
    document.querySelectorAll('#case-open-quantity button').forEach(button => {
        const active = Number(button.dataset.quantity) === count;
        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', String(active));
    });
    const spinBtn = document.getElementById('spin-btn');
    const fastBtn = document.getElementById('fast-spin-btn');
    const mainNote = document.getElementById('spin-main-note');
    const fastNote = document.getElementById('fast-spin-note');
    const currency = caseData.currency === 'gems' ? 'gems' : 'coins';
    const icon = currency === 'gems' ? PATHS.gem : PATHS.coin;
    const totalCost = Math.max(0, Number(caseData.price) || 0) * count;
    const balance = Number(GameState[currency] || 0);
    const missing = Math.max(0, totalCost - balance);
    const hasCaseFunds = caseData.isAd || missing === 0;
    const fastFee = count;
    const hasFastFunds = hasCaseFunds && Number(GameState.gems || 0) >= fastFee;
    if (spinBtn) {
        spinBtn.innerHTML = caseData.isAd
            ? 'КРУТИТЬ БЕСПЛАТНО'
            : `<img src="${icon}" style="width:18px;height:18px;vertical-align:middle;" onerror="this.style.display='none';"> ОТКРЫТЬ ×${count} · ${totalCost.toLocaleString('ru-RU')}`;
        spinBtn.disabled = isSpinning || !hasCaseFunds;
    }
    if (mainNote) {
        mainNote.textContent = hasCaseFunds ? '' : `Не хватает ${missing.toLocaleString('ru-RU')} ${currency === 'gems' ? 'гемов' : 'монет'}.`;
        mainNote.hidden = !mainNote.textContent;
    }
    if (fastBtn) {
        fastBtn.innerHTML = `<img src="${PATHS.gem}" onerror="this.style.display='none';"> БЫСТРО ×${count} · +${fastFee} ГЕМ.`;
        fastBtn.disabled = isSpinning || !hasFastFunds;
    }
    if (fastNote) { fastNote.textContent = ''; fastNote.hidden = true; }
    document.querySelectorAll('#case-open-quantity button').forEach(button => { button.disabled = isSpinning; });
}

function rouletteCardMarkup(entry, winner = false) {
    const tier = Math.max(1, Math.min(6, Number(entry?.tier) || 1));
    const color = tierColors[tier] || '#d8dfe5';
    const image = escapeHtml(entry?.item?.image || '');
    return `<div class="reel-card tier-${tier}${winner ? ' reel-card-winner' : ''}" style="--reel-tier-color:${color}"${winner ? ' data-server-result="true"' : ''}>${itemSprite(image, 'reel-item-atlas')}</div>`;
}

function renderRouletteLanes(count = selectedOpenQuantity) {
    const strip = document.getElementById('roulette-strip');
    const container = document.getElementById('roulette-container');
    if (!strip || !container) return false;
    const safeCount = Math.max(1, Math.min(10, Math.floor(Number(count) || 1)));
    const variants = currentRouletteVariants.length ? currentRouletteVariants : [];
    if (!variants.length) {
        strip.innerHTML = '<div class="roulette-empty-state">В ЭТОМ КЕЙСЕ НЕТ ПРЕДМЕТОВ</div>';
        return false;
    }
    container.classList.toggle('multi-lane-container', safeCount === 10);
    container.classList.toggle('stacked-lanes-container', safeCount === 3 || safeCount === 5);
    container.classList.toggle('single-reel-container', safeCount === 1);
    container.classList.remove('is-spinning');
    strip.className = `roulette-reels horizontal-reels ${safeCount === 1 ? 'single-reel' : ''} ${safeCount === 10 ? 'multi-lane' : ''} ${safeCount === 3 || safeCount === 5 ? 'stacked-lanes' : ''}`;
    strip.innerHTML = Array.from({ length: safeCount }, (_, laneIndex) => {
        const cards = Array.from({ length: ROULETTE_TARGET_INDEX + ROULETTE_TRAILING_CARDS + 1 }, () => {
            const entry = variants[Math.floor(Math.random() * variants.length)];
            return rouletteCardMarkup(entry);
        });
        return `<section class="horizontal-reel" aria-label="Лента ${laneIndex + 1}"><div class="reel-viewport"><div class="reel-track">${cards.join('')}</div></div><span class="reel-center-line" aria-hidden="true"></span><span class="reel-target-frame" aria-hidden="true"></span></section>`;
    }).join('');
    return true;
}

function applyRouletteRewards(rewards) {
    const strip = document.getElementById('roulette-strip');
    const lanes = strip ? [...strip.querySelectorAll('.horizontal-reel')] : [];
    if (!Array.isArray(rewards) || lanes.length !== rewards.length) return false;
    rewards.forEach((reward, index) => {
        const target = lanes[index]?.querySelector('.reel-track')?.children?.[ROULETTE_TARGET_INDEX];
        if (!target || !reward?.item) return;
        const tier = Math.max(1, Math.min(6, Number(reward.tier) || 1));
        target.className = `reel-card tier-${tier} reel-card-winner`;
        target.style.setProperty('--reel-tier-color', tierColors[tier] || '#d8dfe5');
        target.dataset.serverResult = 'true';
        const image = target.querySelector('.item-atlas');
        if (image) setItemAtlasElement(image, reward.item.image || reward.item.id);
    });
    return true;
}

async function decodeRouletteWinners() {
    const strip = document.getElementById('roulette-strip');
    if (!strip) return;
    await preloadItemAtlas();
}

function showRoulette(caseData) {
    currentRouletteCase = caseData;
    currentCaseDetailId = Number(caseData.id);
    currentRouletteResult = null;
    isSpinning = false;

    const overlay = document.getElementById('roulette-overlay');
    if (overlay) overlay.classList.add('show');
    const backBtn = document.getElementById('back-roulette-btn');
    if (backBtn) backBtn.disabled = false;
    const spinBtn = document.getElementById('spin-btn');
    if (spinBtn) spinBtn.disabled = false;
    selectedOpenQuantity = 1;
    const quantityControl = document.getElementById('case-open-quantity');
    if (quantityControl) {
        quantityControl.hidden = Boolean(caseData.isAd);
        quantityControl.querySelectorAll('button').forEach(button => {
            const active = Number(button.dataset.quantity) === 1;
            button.classList.toggle('active', active);
            button.setAttribute('aria-pressed', String(active));
        });
    }
    updateOpeningButtons();
    currentRouletteVariants = getDropTable(caseData.id).map(d => ({ item: getItemById(d.itemId), tier: d.tier })).filter(v => v.item);
    if (!currentRouletteVariants.length) { playError(); showNotification('ОШИБКА: НЕТ ПРЕДМЕТОВ В КЕЙСЕ'); return; }
    renderRouletteLanes(1);

}

function goBackFromRoulette() {
    // Во время вращения выход из рулетки запрещён: результат должен завершиться серверно.
    if (isSpinning) { playError(); return; }
    // После завершения можно вернуться в список кейсов.
    isSpinning = false;
    document.getElementById('roulette-overlay')?.classList.remove('show');
    document.getElementById('result-overlay')?.classList.remove('show');
    currentRouletteCase = null;
    currentRouletteVariants = [];
    currentRouletteResult = null;
    currentCaseDetailId = null;
    const panel = document.getElementById('panel-shop');
    if (panel) panel.dataset.view = 'list';
    if (typeof setActiveTabVisual === 'function') setActiveTabVisual('shop');
    renderCaseListView();
}


async function spinRoulette() {
    if (!currentRouletteCase || isSpinning) { playError(); return; }
    if (typeof gameAction !== 'function') { playError(); showNotification('СЕРВЕРНОЕ API НЕДОСТУПНО'); return; }
    isSpinning = true;
    updateOpeningButtons();
    const backBtn = document.getElementById('back-roulette-btn'); if (backBtn) backBtn.disabled = true;
    const spinBtn = document.getElementById('spin-btn');
    if (spinBtn) spinBtn.disabled = true;
    try {
        const data = await gameAction('openCase', { caseId: currentRouletteCase.id, quantity: selectedOpenQuantity, fast: false });
        currentRouletteResult = data.result;
        const rewards = Array.isArray(data.result?.items) ? data.result.items : [{ item: data.result?.item, tier: data.result?.tier }];
        const firstReward = rewards[0];
        const strip = document.getElementById('roulette-strip');
        const container = document.getElementById('roulette-container');
        if (!firstReward?.item) throw new Error('Сервер не вернул предмет. Проверьте инвентарь и историю открытий.');
        if (!strip || !container) {
            notifyLevelUp(data.result);
            document.getElementById('roulette-overlay')?.classList.remove('show');
            showResult(firstReward.item, firstReward.tier, { ...data.result, items: rewards });
            updateBalance(); renderProfile?.(); renderHouse?.(); currentRouletteResult = null; isSpinning = false;
            if (backBtn) backBtn.disabled = false;
            return;
        }
        const reelCount = rewards.length;
        if (reelCount !== selectedOpenQuantity) throw new Error('Количество предметов в ответе сервера не совпадает с выбранным.');
        if (!currentRouletteVariants.length) throw new Error('Не удалось подготовить предметы для прокрутки.');
        if (!applyRouletteRewards(rewards)) throw new Error('Подготовленные ленты не совпадают с выбранным количеством.');
        await decodeRouletteWinners();
        container.classList.add('is-spinning');
        const targetIndex = ROULETTE_TARGET_INDEX;
        const lanes = [...strip.querySelectorAll('.horizontal-reel')];
        const tracks = lanes.map(lane => lane.querySelector('.reel-track'));
        const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        await new Promise(resolve => {
            let completed = 0;
            const timers = [];
            const frames = new Set();
            let settled = false;
            const clearAll = () => {
                timers.forEach(timer => clearTimeout(timer));
                frames.forEach(frame => cancelAnimationFrame(frame));
                frames.clear();
            };
            const finish = () => {
                if (settled) return;
                settled = true;
                clearAll();
                resolve();
            };
            const laneFinished = () => {
                completed += 1;
                if (completed >= tracks.length) finish();
            };
            tracks.forEach((track, index) => {
                const lane = lanes[index];
                const viewport = lane.querySelector('.reel-viewport');
                const target = track.children[targetIndex];
                const destination = (viewport.clientWidth / 2) - (target.offsetLeft + target.offsetWidth / 2);
                track.style.transition = 'none';
                track.style.transform = 'translate3d(0,0,0)';
                void track.offsetWidth;
                const duration = reducedMotion ? 1 : 4650 + index * 55;
                const delay = reducedMotion ? 0 : index * 55;
                const timerId = setTimeout(() => {
                    if (reducedMotion) {
                        track.style.transform = `translate3d(${destination}px,0,0)`;
                        laneFinished();
                        return;
                    }
                    const startedAt = performance.now();
                    const firstCard = track.children[0];
                    const cardWidth = firstCard.getBoundingClientRect().width;
                    const gap = Math.max(0, parseFloat(getComputedStyle(track).columnGap) || 0);
                    const step = Math.max(1, cardWidth + gap);
                    let lastSlot = -1;
                    let done = false;
                    const stopFrameLoop = () => {
                        done = true;
                        if (frameId) { cancelAnimationFrame(frameId); frames.delete(frameId); }
                    };
                    let frameId = 0;
                    const tickLoop = now => {
                        frames.delete(frameId);
                        if (done || settled) return;
                        const viewportRect = viewport.getBoundingClientRect();
                        const trackRect = track.getBoundingClientRect();
                        const centerOffset = viewportRect.left + viewportRect.width / 2 - trackRect.left;
                        const currentSlot = Math.max(0, Math.min(targetIndex, Math.floor(centerOffset / step)));
                        if (currentSlot > lastSlot) {
                            // Attempt one tick for every card that crossed the marker since the last frame.
                            for (let passed = Math.max(1, lastSlot + 1); passed <= currentSlot; passed++) playRouletteTick();
                            lastSlot = currentSlot;
                        }
                        if (now - startedAt < duration) {
                            frameId = requestAnimationFrame(tickLoop);
                            frames.add(frameId);
                        } else {
                            stopFrameLoop();
                        }
                    };
                    track.style.transition = `transform ${duration}ms cubic-bezier(.38,.72,.2,1)`;
                    track.style.transform = `translate3d(${destination}px,0,0)`;
                    frameId = requestAnimationFrame(tickLoop);
                    frames.add(frameId);
                    // transitionend is preferred; the timer is a safety net for hidden tabs or detached nodes.
                    let transitionDone = false;
                    const onTransitionEnd = event => {
                        if (event.propertyName !== 'transform' || transitionDone) return;
                        transitionDone = true;
                        track.removeEventListener('transitionend', onTransitionEnd);
                        stopFrameLoop();
                        laneFinished();
                    };
                    track.addEventListener('transitionend', onTransitionEnd);
                    timers.push(setTimeout(() => {
                        if (transitionDone || settled) return;
                        transitionDone = true;
                        track.removeEventListener('transitionend', onTransitionEnd);
                        stopFrameLoop();
                        laneFinished();
                    }, duration + 120));
                }, delay);
                timers.push(timerId);
            });
        });
        document.getElementById('roulette-container')?.classList.remove('is-spinning');
        playWinSound();
        notifyLevelUp(data.result);
        setTimeout(() => {
            document.getElementById('roulette-overlay')?.classList.remove('show');
            showResult(firstReward.item, firstReward.tier, { ...currentRouletteResult, items: rewards });
            updateBalance();
            renderProfile?.();
            renderHouse?.();
            currentRouletteResult=null; isSpinning=false; const backBtn=document.getElementById('back-roulette-btn'); if(backBtn) backBtn.disabled=false;
        },220);
    } catch(e) {
        document.getElementById('roulette-container')?.classList.remove('is-spinning');
        isSpinning=false; updateOpeningButtons(); const backBtn=document.getElementById('back-roulette-btn'); if(backBtn) backBtn.disabled=false; playError(); showNotification(e.message||'Не удалось открыть кейс');
    }
}

async function fastSpin() {
    if (!currentRouletteCase || isSpinning) { playError(); return; }
    if (typeof gameAction !== 'function') { playError(); return; }
    isSpinning=true;
    updateOpeningButtons();
    try {
        const data=await gameAction('openCase',{caseId:currentRouletteCase.id,quantity:selectedOpenQuantity,fast:true});
        const result=data.result;
        notifyLevelUp(result);
        const rewards=Array.isArray(result?.items)?result.items:[{item:result?.item,tier:result?.tier}];
        document.getElementById('roulette-overlay')?.classList.remove('show');
        document.getElementById('roulette-container')?.classList.remove('is-spinning');
        if(rewards[0]?.item) showResult(rewards[0].item,rewards[0].tier,{...result,items:rewards});
        updateBalance();
        renderProfile?.(); renderHouse?.();
        currentRouletteResult=null; isSpinning=false; const backBtn=document.getElementById('back-roulette-btn'); if(backBtn) backBtn.disabled=false;
    } catch(e) { document.getElementById('roulette-container')?.classList.remove('is-spinning'); isSpinning=false; updateOpeningButtons(); const backBtn=document.getElementById('back-roulette-btn'); if(backBtn) backBtn.disabled=false; playError(); showNotification(e.message||'Не удалось открыть кейс'); }
}

function notifyLevelUp(result) {
    const levels = Math.max(0, Number(result?.totalLevels) || 0);
    if (!levels) return;
    const coins = Math.max(0, Number(result?.totalLevelCoins) || 0);
    const gems = Math.max(0, Number(result?.totalLevelGems) || 0);
    if (typeof playLevelUp === 'function') playLevelUp();
    const parts = [`НОВЫЙ УРОВЕНЬ ${Number(GameState.level)||''}`];
    if (coins) parts.push(`+${coins.toLocaleString('ru-RU')} МОНЕТ`);
    if (gems) parts.push(`+${gems.toLocaleString('ru-RU')} ГЕМ.`);
    showNotification(parts.join(' · '), 5200);
}

// ==================== РЕЗУЛЬТАТ ====================

function showResult(item, tier, stats = {}) {
    const resultImage = document.getElementById('result-image');
    const resultName = document.getElementById('result-name');
    const resultTier = document.getElementById('result-tier');
    const resultContent = document.getElementById('result-content');
    const resultOverlay = document.getElementById('result-overlay');
    if (!resultImage || !resultName || !resultTier || !resultContent || !resultOverlay) return;

    const rewards = Array.isArray(stats.items) && stats.items.length ? stats.items : [{ item, tier }];
    const isBulk = rewards.length > 1;
    resultImage.style.display = isBulk || !item.image ? 'none' : 'block';
    setItemAtlasElement(resultImage, item.image || item.id);
    resultName.textContent = isBulk ? `ПОЛУЧЕНО ПРЕДМЕТОВ: ${rewards.length}` : item.name;
    resultTier.textContent = isBulk ? '' : (tierNames[tier] || 'ПРЕДМЕТ');
    resultTier.style.display = isBulk ? 'none' : 'block';
    resultTier.style.color = tierColors[Math.max(...rewards.map(x => Number(x.tier) || 1))] || tierColors[1];
    let statsEl = document.getElementById('result-stats');
    if (!statsEl) { statsEl = document.createElement('div'); statsEl.id = 'result-stats'; resultTier.insertAdjacentElement('afterend', statsEl); }
    const gainedXp = Number(stats.totalXp ?? stats.xp ?? rewards[0]?.xp ?? 0);
    const gainedRating = Number(stats.totalRating ?? stats.rating ?? rewards[0]?.rating ?? 0);
    statsEl.innerHTML = `<span>ОПЫТ <b>+${gainedXp.toLocaleString('ru-RU')}</b></span><span>РЕЙТИНГ <b>+${gainedRating.toLocaleString('ru-RU')}</b></span>`;

    let bulkGrid = document.getElementById('bulk-result-grid');
    if (!bulkGrid) { bulkGrid = document.createElement('div'); bulkGrid.id = 'bulk-result-grid'; statsEl.insertAdjacentElement('afterend', bulkGrid); }
    bulkGrid.hidden = !isBulk;
    bulkGrid.style.setProperty('--bulk-result-columns', String(Math.min(5, rewards.length)));
    bulkGrid.innerHTML = isBulk ? rewards.map(reward => {
        const drop = reward.item || {};
        const rarity = Number(reward.tier) || 1;
        return `<div class="bulk-result-item tier-${rarity}" style="--reel-tier-color:${tierColors[rarity] || '#d8dfe5'}">${itemSprite(drop.image, 'bulk-item-atlas')}<b>${escapeHtml(drop.name || 'Предмет')}</b></div>`;
    }).join('') : '';

    resultContent.style.borderColor = 'var(--border-color)';
    resultOverlay.classList.add('show');
    if (rewards.some(reward => Number(reward.tier) >= 4)) spawnConfetti();
}

function closeResult() {
    document.getElementById('result-overlay')?.classList.remove('show');
    const caseId = currentCaseDetailId || currentRouletteCase?.id;
    currentRouletteResult = null;
    isSpinning = false;
    if (caseId) {
        const caseData = getCaseById(caseId);
        currentRouletteCase = caseData || null;
        if (caseData) showCaseDetail(caseData);
        else backToCaseList();
    } else {
        backToCaseList();
    }
}





// ==================== ИСТОРИЯ ОТКРЫТИЙ ====================

async function openCaseHistory() {
    let overlay = document.getElementById('case-history-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'case-history-overlay';
        overlay.className = 'case-history-overlay';
        overlay.innerHTML = `<section class="case-history-panel" role="dialog" aria-modal="true" aria-labelledby="case-history-title"><header><h3 id="case-history-title">ИСТОРИЯ ОТКРЫТИЙ</h3><button type="button" aria-label="Закрыть" onclick="playClick(); closeCaseHistory()">×</button></header><div id="case-history-summary"></div><div id="case-history-entries"></div><button type="button" class="case-history-close" onclick="playClick(); closeCaseHistory()">ЗАКРЫТЬ</button></section>`;
        (document.fullscreenElement || document.getElementById('app') || document.body).appendChild(overlay);
    }
    const fullscreenRoot = document.fullscreenElement || document.getElementById('app') || document.body;
    if (overlay.parentElement !== fullscreenRoot) fullscreenRoot.appendChild(overlay);
    const themeRoot=document.getElementById('app');
    for(const key of ['skin','corners']){const value=themeRoot?.getAttribute('data-'+key);if(value)overlay.setAttribute('data-'+key,value);else overlay.removeAttribute('data-'+key);}
    overlay.classList.add('show');
    const list = document.getElementById('case-history-entries');
    if (list) list.innerHTML = '<div class="case-history-loading" role="status">ЗАГРУЖАЕМ ИСТОРИЮ…</div>';
    try {
        const data = await apiRequest('/api/case-history?limit=10', { timeoutMs: 15000 });
        renderCaseHistory(data);
    } catch (error) {
        if (list) list.innerHTML = `<div class="case-history-loading" role="alert">${escapeHtml(error.message || 'Не удалось загрузить историю')}<button type="button" class="case-history-retry" onclick="playClick(); openCaseHistory()">ПОВТОРИТЬ</button></div>`;
    }
}

function closeCaseHistory() { document.getElementById('case-history-overlay')?.classList.remove('show'); }

function renderCaseHistory(data) {
    const summary = document.getElementById('case-history-summary');
    const list = document.getElementById('case-history-entries');
    if (!summary || !list) return;
    const stats = data.stats || {};
    summary.innerHTML = `<div class="case-history-stats"><span>СЕРИЙ ОТКРЫТИЙ<b>${Number(stats.openings || 0).toLocaleString('ru-RU')}</b></span><span>ОТКРЫТО КЕЙСОВ<b>${Number(stats.cases || 0).toLocaleString('ru-RU')}</b></span></div>`;
    const html = (data.entries || []).slice(0, 10).map(entry => {
        const caseData = getCaseById(entry.caseId);
        const caseImage = caseData?.image || `png/cases/case_${Number(entry.caseId)}.png`;
        const rewards = Array.isArray(entry.result?.items) && entry.result.items.length
            ? entry.result.items
            : [{ item: entry.result?.item, tier: entry.result?.tier }];
        const rewardHtml = rewards.slice(0, 10).map(reward => {
            const drop = reward.item || {};
            const tier = Math.max(1, Math.min(6, Number(reward.tier) || 1));
            const localItem = typeof getItemById === 'function' ? getItemById(Number(drop.id)) : null;
            const itemName = String(drop.name || localItem?.name || (Number(drop.id) > 0 ? `ПРЕДМЕТ #${Number(drop.id)}` : 'ПРЕДМЕТ'));
            const itemImage = String(drop.image || localItem?.image || '');
            const rarityName = (typeof tierNames !== 'undefined' && tierNames[tier]) ? tierNames[tier] : `Редкость ${tier}`;
            const color = tierColors[tier] || '#d8dfe5';
            const imageMarkup = itemImage ? itemSprite(itemImage, 'case-history-item-atlas') : '<span class="case-history-image-fallback">◇</span>';
            return `<div class="case-history-drop tier-${tier}" style="--drop-tier:${color}" title="${escapeHtml(itemName)}" aria-label="${escapeHtml(itemName)}"><div class="case-history-drop-art">${imageMarkup}</div></div>`;
        }).join('');
        const createdAt = Number(entry.createdAt);
        const dateObject = createdAt > 0 && Number.isFinite(createdAt) ? new Date(createdAt < 1e12 ? createdAt * 1000 : createdAt) : null;
        const date = dateObject && !Number.isNaN(dateObject.getTime()) ? `${String(dateObject.getDate()).padStart(2,'0')}.${String(dateObject.getMonth()+1).padStart(2,'0')}.${dateObject.getFullYear()}` : '—';
        const caseName = caseData?.name || `Кейс #${entry.caseId}`;
        const dateTimeAttribute = dateObject && !Number.isNaN(dateObject.getTime()) ? ` datetime="${dateObject.toISOString()}"` : '';
        return `<article class="case-history-entry" data-history-id="${Number(entry.id)||0}"><div class="case-history-entry-head"><span class="case-history-case-title"><img src="${escapeHtml(caseImage)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'"><span class="case-history-case-copy"><b>${escapeHtml(caseName)}</b></span></span><time class="case-history-date"${dateTimeAttribute}>${escapeHtml(date)}</time></div><div class="case-history-rewards-head"><span>ПОЛУЧЕННЫЕ ПРЕДМЕТЫ</span></div><div class="case-history-drops" aria-label="Полученные предметы">${rewardHtml}</div></article>`;
    }).join('');
    list.innerHTML = html || '<div class="case-history-loading">ОТКРЫТИЙ ПОКА НЕТ</div>';
}

bindAdRewardGate();
console.log('[CASES] Модуль кейсов загружен');