// js/profile.js - АДАПТИРОВАНО: GameState, syncGlobals, новые пути

let selectedForSell = [];
let inventorySortMode = 'date';
let currentSellStackIndices = [];
let currentSellQuantity = 1;
let inventoryTab = 'items';
let inventorySearch = '';
let inventoryTierFilter = 'all';
let progressionRenderRequest = 0;

function renderProfile() {
    const container = document.getElementById('profile-content');
    if (!container) return;
    const currentAvatar = getAvatarById(GameState.selectedAvatar) || getAvatarById(1);
    const avatarSrc = currentAvatar ? currentAvatar.image : 'png/avatars/avatar_1.png';
    const percent = Math.min(100, Math.floor((GameState.experience / GameState.expToNext) * 100));
    const ownedCount = (GameState.ownedAvatars || []).filter(id => Number(id) >= 1 && Number(id) <= 106).length;
    container.innerHTML = `
        <section id="profile-section" class="profile-hub" aria-label="Профиль игрока">
            <div class="profile-hub-eyebrow"><span class="profile-hub-live"></span> ДОСЬЕ ИГРОКА <span class="profile-hub-tag">ZOMBIX</span></div>
            <div class="profile-hub-identity">
                <button class="profile-hub-avatar-button" type="button" onclick="playClick();openAvatarsModal()" aria-label="Выбрать аватар">
                    ${avatarMarkup(avatarSrc, 'profile-avatar-sprite', 'id="profile-avatar"')}
                    <span class="profile-hub-avatar-edit" aria-hidden="true">✎</span>
                    <span class="profile-hub-level" aria-label="Уровень ${GameState.level}"><small>УР.</small>${GameState.level}</span>
                </button>
                <div class="profile-hub-persona">
                    <span class="profile-hub-caption">ПОЗЫВНОЙ ВЫЖИВШЕГО</span>
                    <div id="profile-name-wrap"><div id="profile-name">${escapeHtml(GameState.nickname || (typeof playerName !== 'undefined' ? playerName : 'СТАЛКЕР'))}</div><button id="nickname-edit-btn" type="button" aria-label="Изменить никнейм" title="Изменить никнейм" onclick="playClick(); openNicknameModal();">✎</button></div>
                    <button type="button" class="profile-hub-avatar-link" onclick="playClick();openAvatarsModal()">АВАТАРЫ <span>${ownedCount}/106 →</span></button>
                </div>
            </div>
            <div class="profile-hub-progress">
                <div class="profile-hub-progress-label"><span>ПРОГРЕСС УРОВНЯ</span><strong>${Math.round(percent)}%</strong></div>
                <div id="profile-exp-bar-container" role="progressbar" aria-valuenow="${percent}" aria-valuemin="0" aria-valuemax="100"><div id="profile-exp-bar" style="width:${percent}%"></div></div>
                <div id="profile-exp-text"><span>УР. ${GameState.level} → УР. ${GameState.level + 1}</span><span>${formatNumber(GameState.experience)} / ${formatNumber(GameState.expToNext)} XP</span></div>
            </div>
            <div class="profile-hub-stats profile-stats-grid profile-stats-compact">
                <div class="profile-stat-card cases"><span>ОТКРЫТО КЕЙСОВ</span><b>${formatNumber(GameState.totalCasesOpened||0)}</b><small>ВСЕГО</small></div>
                <div class="profile-stat-card rating"><span>РЕЙТИНГ</span><b>${formatNumber(GameState.rating||0)}</b><small>ОЧКОВ</small></div>
            </div>
        </section>
        <div id="inventory-section">
            <div id="inventory-title">
                <div class="inventory-wallet"><img src="png/ui/shards.png" alt=""><b id="inventory-shard-balance">${formatNumberFull(GameState.shards||0)}</b></div><h3>ИНВЕНТАРЬ</h3>
                <div class="inventory-tools"><button id="inventory-sort" onclick="setInventorySort();">ДАТА</button></div>
            </div>
            <div class="inventory-tabs" role="tablist" aria-label="Разделы инвентаря">
                <button type="button" role="tab" data-inventory-tab="items" aria-selected="${inventoryTab==='items'}" class="${inventoryTab==='items'?'active':''}" onclick="playClick();setInventoryTab('items')">ПРЕДМЕТЫ <span>${GameState.inventory.length}</span></button>
                <button type="button" role="tab" data-inventory-tab="artifacts" aria-selected="${inventoryTab==='artifacts'}" class="${inventoryTab==='artifacts'?'active':''}" onclick="playClick();setInventoryTab('artifacts')">АРТЕФАКТЫ <span>${(GameState.artifacts||[]).reduce((n,a)=>n+Number(a.count||0),0)}</span></button>
            </div>
            <div class="inventory-filterbar"><input id="inventory-search" type="search" maxlength="48" placeholder="Поиск предмета…" aria-label="Поиск предмета" oninput="setInventorySearch(this.value)"><select id="inventory-tier-filter" aria-label="Фильтр редкости" onchange="setInventoryTierFilter(this.value)"><option value="all">Все редкости</option><option value="1">Обычные</option><option value="2">Необычные</option><option value="3">Редкие</option><option value="4">Эпические</option><option value="5">Легендарные</option><option value="6">Мифические</option></select></div>
            <div class="inventory-grid-frame"><div id="inventory-grid"></div></div>
            <div id="sell-controls" style="display:none;"></div>
        </div>
    `;

    selectedForSell = [];
    renderInventory();
    renderProfileArtifacts();
}


async function claimAchievement(id, button = null) {
    if (button?.disabled) return;
    if (button) { button.disabled = true; button.textContent = 'ПОЛУЧАЕМ…'; }
    try {
        // The server is the source of truth for the claim flag. Never mark locally before this succeeds.
        const data = await idempotentApiAction('achievement_claim', '/api/progression/claim', { achievementId: String(id) });
        applyServerState(data.state);
        updateBalance();
        showNotification('НАГРАДА ЗА ДОСТИЖЕНИЕ ПОЛУЧЕНА', 2600);
        if (document.getElementById('quests-modal')?.classList.contains('show') && typeof questTab !== 'undefined' && questTab === 'achievements') {
            await renderQuestModal();
        } else if (document.getElementById('simple-game-modal')?.classList.contains('show')) {
            await openProgressAlbum();
        }
    } catch (error) {
        showNotification(error.message || 'НЕ УДАЛОСЬ ПОЛУЧИТЬ НАГРАДУ', 3000);
        if (button) { button.disabled = false; button.textContent = 'ЗАБРАТЬ НАГРАДУ'; }
    }
}

function achievementRewardHTML(reward = {}) {
    const parts = [];
    if (Number(reward.coins) > 0) parts.push(`<span><img src="png/ui/coin.png" alt="">${formatNumberFull(reward.coins)}</span>`);
    if (Number(reward.gems) > 0) parts.push(`<span><img src="png/ui/gem.png" alt="">${formatNumberFull(reward.gems)}</span>`);
    if (Number(reward.shards) > 0) parts.push(`<span><img src="png/ui/shards.png" alt="">${formatNumberFull(reward.shards)}</span>`);
    return parts.join('') || '<span class="achievement-no-reward">Без награды</span>';
}

function renderProgressionCards(data) {
    const achievements = Array.isArray(data?.achievements) ? data.achievements.slice() : [];
    const active = achievements.filter(item => !item.claimed).sort((a, b) => {
        if (!!a.claimable !== !!b.claimable) return a.claimable ? -1 : 1;
        if (!!a.completed !== !!b.completed) return a.completed ? -1 : 1;
        const ar = Number(a.target) > 0 ? Number(a.progress) / Number(a.target) : 0;
        const br = Number(b.target) > 0 ? Number(b.progress) / Number(b.target) : 0;
        return br - ar;
    });
    const completed = achievements.filter(item => !!item.claimed);
    const renderCard = a => {
        const target = Math.max(1, Number(a.target) || 1);
        const progress = Math.max(0, Math.min(target, Number(a.progress) || 0));
        const pct = Math.max(0, Math.min(100, progress / target * 100));
        const stateClass = a.claimed ? 'claimed' : a.claimable ? 'claimable' : a.completed ? 'completed' : 'in-progress';
        const stateLabel = a.claimed ? 'ПОЛУЧЕНО' : a.claimable ? 'ДОСТУПНО' : a.completed ? 'ВЫПОЛНЕНО' : 'В ПРОЦЕССЕ';
        const safeId = String(a.id || '').replace(/[^a-zA-Z0-9_-]/g, '');
        return `<article class="progress-achievement quest-achievement-card ${stateClass}">
            <div class="achievement-card-top"><span class="achievement-state">${stateLabel}</span><div class="progress-achievement-reward">${achievementRewardHTML(a.reward)}</div></div>
            <div class="achievement-card-heading"><div><b>${escapeHtml(a.title || 'Достижение')}</b><p>${escapeHtml(a.description || '')}</p></div></div>
            <div class="achievement-progress-line"><strong>${progress.toLocaleString('ru-RU')} / ${target.toLocaleString('ru-RU')}</strong><span>${Math.round(pct)}%</span></div>
            <div class="progress-achievement-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(pct)}"><i style="width:${pct}%"></i></div>
            ${a.claimable ? `<button type="button" class="progress-achievement-claim" onclick="claimAchievement('${safeId}',this)">ЗАБРАТЬ НАГРАДУ</button>` : ''}
        </article>`;
    };
    return `<div class="achievement-summary"><span>АКТИВНЫЕ ДОСТИЖЕНИЯ</span><strong>${active.length}</strong></div>
        <div class="quest-achievements-grid">${active.map(renderCard).join('') || '<div class="artifact-inventory-empty"><b>ПОКА НЕТ ДОСТИЖЕНИЙ</b><span>Открывай кейсы, собирай коллекцию и развивай аккаунт.</span></div>'}</div>
        ${completed.length ? `<section class="achievement-completed-section"><header><b>ЗАВЕРШЕНО</b><span>${completed.length}</span></header><div class="quest-achievements-grid">${completed.map(renderCard).join('')}</div></section>` : ''}`;
}

async function openProgressAlbum() {
    // Backwards-compatible entry point: achievements are now a tab in the quest hub.
    if (typeof openQuestsModal === 'function') return openQuestsModal('achievements');
}


function renderProfileArtifacts(){
    const grid=document.getElementById('artifact-profile-grid');if(!grid)return;
    const rows=(GameState.artifacts||[]).filter(x=>x.count>0);
    if(!rows.length){grid.innerHTML='<div class="artifact-profile-empty">АРТЕФАКТЫ ПОКА НЕ ПОЛУЧЕНЫ</div>';return;}
    grid.innerHTML=rows.map(x=>{const a=(ARTIFACTS_DATABASE.artifacts||[]).find(v=>Number(v.id)===Number(x.id));return a?`<div class="artifact-profile-card">${artifactSprite(a.id)}<b>${escapeHtml(a.name)}</b><span>×${x.count}</span></div>`:''}).join('');
}

function openNicknameModal(){
    const old=String(GameState.nickname||playerName||'').trim();
    openSimpleGameModal('ИЗМЕНИТЬ НИКНЕЙМ', `<div class="account-field"><label>НИКНЕЙМ</label><input id="nickname-input" maxlength="24" pattern="[A-Za-zА-Яа-яЁё0-9._×-]+" value="${escapeHtml(old)}" autocomplete="nickname" oninput="this.value=this.value.replace(/[^A-Za-zА-Яа-яЁё0-9._×-]/g,'')"><small>3–24 символа: русские/английские буквы, цифры и - . _ ×</small></div><button class="profile-modal-btn" onclick="saveNicknameFromModal();">СОХРАНИТЬ</button>`);
    setTimeout(()=>{const el=document.getElementById('nickname-input');el?.focus();el?.select();},40);
}
async function saveNicknameFromModal(){const el=document.getElementById('nickname-input');const nickname=String(el?.value||'').trim();if(nickname.length<3||nickname.length>24){showNotification('Никнейм: 3–24 символа.');return;} if(!/^[A-Za-zА-Яа-яЁё0-9._×-]+$/.test(nickname)){showNotification('Только буквы, цифры и - . _ ×');return;}try{const data=await gameAction('changeNickname',{nickname});GameState.nickname=data.result.nickname;playerName=GameState.nickname;window.__playerName=playerName;closeSimpleGameModal();renderProfile();showNotification('НИКНЕЙМ СОХРАНЁН');}catch(e){showNotification(e.message||'Не удалось изменить никнейм');}}
function openSimpleGameModal(title,body){let m=document.getElementById('simple-game-modal');if(!m){m=document.createElement('div');m.id='simple-game-modal';(document.getElementById('app')||document.body).appendChild(m);}m.innerHTML=`<div class="simple-game-card"><div class="simple-game-title">${escapeHtml(title)}</div><div class="simple-game-modal-body">${body}</div><button type="button" class="simple-game-close" onclick="closeSimpleGameModal()">ЗАКРЫТЬ</button></div>`;m.classList.add('show');}
function closeSimpleGameModal(){progressionRenderRequest++;document.getElementById('simple-game-modal')?.classList.remove('show');}

function setInventoryTab(tab){
    inventoryTab = tab==='artifacts' ? 'artifacts' : 'items';
    document.querySelectorAll('.inventory-tabs [data-inventory-tab]').forEach(button => {
        const active = button.dataset.inventoryTab === inventoryTab;
        button.classList.toggle('active', active);
        button.setAttribute('aria-selected', String(active));
    });
    const sort=document.getElementById('inventory-sort');
    const controls=document.getElementById('sell-controls');
    if(sort) { sort.style.display=''; sort.setAttribute('aria-label', inventoryTab==='artifacts'?'Сортировка предметов (доступна во вкладке Предметы)':'Сортировка предметов'); sort.disabled=inventoryTab==='artifacts'; }
    if(controls && inventoryTab==='artifacts') controls.style.display='none';
    selectedForSell=[];
    renderInventory();
}
function renderArtifactInventoryTab(){
 const grid=document.getElementById('inventory-grid');if(!grid)return;
 const rows=(GameState.artifacts||[]).filter(x=>Number(x.count)>0);
 if(!rows.length){grid.innerHTML='<div class="artifact-inventory-empty"><b>АРТЕФАКТОВ ПОКА НЕТ</b><span>Сохранённые артефакты появятся здесь.</span></div>';return;}
 grid.innerHTML=rows.map(x=>{const a=(ARTIFACTS_DATABASE.artifacts||[]).find(v=>Number(v.id)===Number(x.id));return a?`<button class="inv-artifact-card inv-artifact-open" onclick="playClick();openArtifactSell(${a.id})"><div class="inv-artifact-frame">${artifactSprite(a.id)}</div><b>${escapeHtml(a.name)}</b><span class="inv-artifact-quantity">×${x.count}</span></button>`:''}).join('');
}
let artifactSaleQuoteCache={};
async function openArtifactSell(id){const a=(ARTIFACTS_DATABASE.artifacts||[]).find(v=>Number(v.id)===Number(id));const owned=Number(GameState.artifacts?.find(x=>Number(x.id)===Number(id))?.count||0);if(!a||!owned)return;
 let quote='НЕТ АКТИВНЫХ ЛОТОВ';try{const result=await apiRequest('/api/artifacts/quote?artifact='+Number(id));if(result.minPrice)quote='<img src="png/ui/shards.png" class="artifact-shard-icon" alt="осколки"> '+formatNumberFull(result.minPrice);}catch{}
 const unit=[15,20,25,30][Math.min(3,Math.floor((Number(id)-1)/11))],icon='<img src="png/ui/shards.png" class="artifact-shard-icon" alt="осколки">';
 openSimpleGameModal('ПРОДАЖА АРТЕФАКТА',`<div class="artifact-sale-detail"><div class="artifact-sale-image">${artifactSprite(a.id)}</div><b>${escapeHtml(a.name)}</b><span>В НАЛИЧИИ: ${owned}</span><small>МИНИМАЛЬНАЯ ЦЕНА НА РЫНКЕ: ${quote}</small><small>ВЫКУП СИСТЕМОЙ: ${icon} ${formatNumberFull(unit)} ЗА ШТУКУ</small><div class="artifact-sale-quantity"><span>ПРОДАТЬ: <b id="artifact-sale-count">1</b></span><input id="artifact-sale-range" type="range" min="1" max="${Math.min(owned,50)}" value="1" oninput="updateArtifactSaleCount(${unit},this.value)"><div>1 — ${Math.min(owned,50)} ЗА ОДИН РАЗ</div></div><div class="artifact-sale-total">ИТОГО: ${icon} <b id="artifact-sale-total">${formatNumberFull(unit)}</b></div><button class="profile-modal-btn" onclick="recycleArtifact(${id})">ПРОДАТЬ СИСТЕМЕ</button><button class="profile-modal-btn artifact-market-link" onclick="goToArtifactMarket(${id})">ПРОДАТЬ НА РЫНКЕ →</button></div>`);
}
function updateArtifactSaleCount(unit,value){const n=Math.max(1,Math.floor(Number(value)||1));document.getElementById('artifact-sale-count').textContent=n;document.getElementById('artifact-sale-total').textContent=formatNumberFull(n*unit);}
async function goToArtifactMarket(id){closeSimpleGameModal();await openMarket();await selectMarketArtifact(id);}
function setInventorySearch(value){inventorySearch=String(value||'').trim().toLocaleLowerCase('ru-RU');renderInventory();}
function setInventoryTierFilter(value){inventoryTierFilter=['1','2','3','4','5','6'].includes(String(value))?String(value):'all';renderInventory();}
function renderInventory() {
    const grid = document.getElementById('inventory-grid');
    if (!grid) return;
    if (inventoryTab === 'artifacts') { renderArtifactInventoryTab(); updateSellControls(); return; }
    const source = Array.isArray(GameState.inventory) ? GameState.inventory : [];
    const grouped = new Map();
    source.forEach((item, index) => {
        if (!item) return;
        const id = Number(item.id), tier = Number(item.tier);
        let definition = null; try { definition = getItemById(id); } catch (_) {}
        if (!definition) return;
        if (inventoryTierFilter !== 'all' && tier !== Number(inventoryTierFilter)) return;
        const name = String(definition.name || 'Предмет');
        if (inventorySearch && !name.toLocaleLowerCase('ru-RU').includes(inventorySearch) && !String(id).includes(inventorySearch)) return;
        const key = `${id}:${tier}`;
        if (!grouped.has(key)) grouped.set(key, { id, tier, name, indices: [], lastIndex: index });
        const row = grouped.get(key); row.indices.push(index); row.lastIndex = index;
    });
    const rows = [...grouped.values()];
    rows.sort((a,b) => inventorySortMode === 'rarityDown' ? b.tier-a.tier || a.name.localeCompare(b.name,'ru') : inventorySortMode === 'rarityUp' ? a.tier-b.tier || a.name.localeCompare(b.name,'ru') : b.lastIndex-a.lastIndex);
    if (!rows.length) {
        grid.innerHTML = source.length && (inventorySearch || inventoryTierFilter !== 'all')
            ? '<div class="artifact-inventory-empty"><b>НИЧЕГО НЕ НАЙДЕНО</b><span>Измени запрос или фильтр редкости.</span></div>'
            : '<div class="artifact-inventory-empty"><b>ИНВЕНТАРЬ ПУСТ</b><span>Предметы из открытых кейсов появятся здесь.</span></div>';
        updateSellControls(); return;
    }
    const fragment = document.createDocumentFragment();
    rows.forEach(row => {
        const data = getItemById(row.id) || {}, count = row.indices.length;
        const div = document.createElement('button'); div.type = 'button'; div.className = `inv-item tier-${row.tier}`;
        div.setAttribute('aria-label', `${row.name}, количество ${count}, редкость ${row.tier}`);
        const stackSelected = row.indices.some(index => selectedForSell.includes(index));
        if (stackSelected) { div.style.border = '3px solid #4CAF50'; div.style.boxShadow = '0 0 15px rgba(76,175,80,.7)'; }
        const price = Number(data.tiers?.[String(row.tier)]?.price || 0);
        div.innerHTML = `${count > 1 ? `<span class="inv-stack-count" aria-label="Количество: ${count}">×${count}</span>` : ''}${itemSprite(data.image, 'inv-item-image')}<span class="inv-name" title="${escapeHtml(row.name)}">${escapeHtml(row.name)}</span>${stackSelected ? `<span class="inv-selected-value">${formatNumberFull(price*count)} монет</span>` : ''}`;
        div.onclick = () => {
            playClick();
            if (document.getElementById('sell-controls')?.style.display === 'none') showItemInfo(row.id, true, row.indices[0]);
            else {
                const allSelected = row.indices.every(index => selectedForSell.includes(index));
                selectedForSell = allSelected ? selectedForSell.filter(index => !row.indices.includes(index)) : [...new Set([...selectedForSell, ...row.indices])];
                renderInventory();
            }
        };
        fragment.appendChild(div);
    });
    grid.replaceChildren(fragment);
    updateSellControls();
}

function setInventorySort(){
    const order=['date','rarityDown','rarityUp'];
    const labels={date:'ДАТА',rarityDown:'РЕДКОСТЬ ↓',rarityUp:'РЕДКОСТЬ ↑'};
    const current=Math.max(0,order.indexOf(inventorySortMode));
    inventorySortMode=order[(current+1)%order.length];
    const btn=document.getElementById('inventory-sort');
    if(btn) btn.textContent=labels[inventorySortMode];
    playClick();
    renderInventory();
}

function toggleSellMode() {
    selectedForSell = [];
    const controls = document.getElementById('sell-controls');
    const btn = document.getElementById('sell-all-btn');
    
    if (!controls || !btn) return;
    
    if (controls.style.display === 'none') {
        controls.style.display = 'block';
        btn.textContent = 'ОТМЕНА';
        btn.style.background = '#ff6b6b';
        btn.style.color = '#fff';
    } else {
        controls.style.display = 'none';
        btn.textContent = 'ПРОДАЖА';
        btn.style.background = '#ff9800';
        btn.style.color = '#1a1a2e';
    }
    renderInventory();
}

function handleInventoryClick(index) {
    const controls = document.getElementById('sell-controls');
    if (!controls) return;
    
    if (!GameState.inventory[index]) return;
    
    if (controls.style.display === 'none') {
        showItemInfo(GameState.inventory[index].id, true, index);
    } else {
        if (selectedForSell.includes(index)) {
            selectedForSell = selectedForSell.filter(i => i !== index);
        } else {
            selectedForSell.push(index);
        }
        renderInventory();
    }
}

function updateSellControls() {
    const controls = document.getElementById('sell-controls');
    if (!controls || controls.style.display === 'none') return;
    
    const allSelected = selectedForSell.length === GameState.inventory.length && GameState.inventory.length > 0;
    
    let totalPrice = 0;
    selectedForSell.forEach(idx => {
        const item = GameState.inventory[idx];
        if (!item) return;
        const itemData = getItemById(item.id);
        if (itemData?.tiers?.[item.tier]) {
            totalPrice += itemData.tiers[item.tier].price;
        }
    });
    
    controls.innerHTML = `
        <div style="background:rgba(0,0,0,0.5);border-radius:var(--border-radius);padding:15px;margin-top:10px;border:2px solid var(--border-color);">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;font-size:8px;color:var(--text-primary);">
                <span>ВЫБРАНО: ${selectedForSell.length}</span>
                <span style="display:flex;align-items:center;gap:5px;color:var(--border-color);">
                    <img src="png/ui/coin.png" style="width:16px;height:16px;" onerror="this.style.display='none';">
                    ${totalPrice}
                </span>
            </div>
            <button class="menu-btn" style="width:100%; padding:12px; font-size:10px; background:${allSelected ? '#ff9800' : '#4CAF50'};" onclick="playClick(); toggleSelectAll();">${allSelected ? 'СНЯТЬ ВСЕ' : 'ВЫБРАТЬ ВСЕ'}</button>
            <button class="menu-btn" style="width:100%; margin-top:8px; padding:12px; font-size:10px; background:linear-gradient(135deg, #ff9800, #f57c00);" onclick="playClick(); sellSelectedItems();">ПРОДАТЬ</button>
        </div>
    `;
}

function toggleSelectAll() {
    if (selectedForSell.length === GameState.inventory.length && GameState.inventory.length > 0) {
        selectedForSell = [];
    } else {
        selectedForSell = GameState.inventory.map((item, index) => index);
    }
    renderInventory();
}

async function sellSelectedItems() {
    if (!selectedForSell.length) { playError(); showNotification('ВЫБЕРИТЕ ПРЕДМЕТЫ'); return; }
    const indices=[...selectedForSell];
    const totalPrice=indices.reduce((sum,idx)=>{const it=GameState.inventory[idx];return sum+(it?Number(getItemById(it.id)?.tiers?.[String(it.tier)]?.price||0):0)},0);
    openConfirmModal(`Продать ${indices.length} предметов за ${totalPrice} монет?`, async()=>{
        try { const data=await gameAction('sell',{indices}); updateBalance(); showNotification(`ПРОДАНО! +${data.result?.coins||0} МОНЕТ`); selectedForSell=[]; closeModal(); renderProfile(); }
        catch(e){playError();showNotification(e.message||'Не удалось продать предметы');}
    });
}

async function sellAllItems() {
    if (!GameState.inventory.length) { playError(); showNotification('ИНВЕНТАРЬ ПУСТ'); return; }
    const totalCoins=GameState.inventory.reduce((sum,item)=>sum+Number(getItemById(item.id)?.tiers?.[String(item.tier)]?.price||0),0);
    openConfirmModal(`Продать все предметы за ${totalCoins} монет?`, async()=>{
        try { const data=await gameAction('sellAll'); updateBalance(); renderProfile(); showNotification(`ПРОДАНО! +${data.result?.coins||0} МОНЕТ`); }
        catch(e){playError();showNotification(e.message||'Не удалось продать предметы');}
    });
}

function showItemInfo(itemId, fromInventory, invIndex = null) { 
    const item = getItemById(itemId); 
    if (!item) return; 
    
    currentModalItem = item; 
    currentModalItemIsFromInventory = fromInventory; 
    currentModalItemIndex = invIndex; 
    
    const modalImage = document.getElementById('modal-image'); 
    const modalName = document.getElementById('modal-name');
    const modalTier = document.getElementById('modal-tier');
    const modalChance = document.getElementById('modal-chance');
    const modalPrice = document.getElementById('modal-price');
    const itemModalContent = document.getElementById('item-modal-content');
    const sellBtn = document.getElementById('sell-btn');
    const itemModal = document.getElementById('item-modal');
    
    if (!modalImage || !modalName || !modalTier || !modalChance || !modalPrice || !itemModalContent || !sellBtn || !itemModal) return;
    
    const coinImg = '<img src="png/ui/coin.png" style="width:16px;height:16px;vertical-align:middle;" onerror="this.style.display=\'none\';">'; 
    
    if (fromInventory && invIndex !== null && GameState.inventory[invIndex]) {
        const source = GameState.inventory[invIndex];
        const tier = source.tier;
        currentSellStackIndices = GameState.inventory.map((x,i)=>x && Number(x.id)===Number(source.id) && Number(x.tier)===Number(source.tier)?i:-1).filter(i=>i>=0);
        currentSellQuantity = Math.min(currentSellStackIndices.length, 1);
        modalImage.className = 'modal-image item-atlas'; modalImage.style.display = item.image ? 'block' : 'none'; setItemAtlasElement(modalImage, item.image || item.id);
        modalName.textContent = item.name;
        modalTier.textContent = tierNames[tier];
        modalTier.style.color = tierColors[tier];
        modalChance.textContent = `В ИНВЕНТАРЕ: ${currentSellStackIndices.length}`;
        const unitPrice = Number(item.tiers?.[tier]?.price||0);
        modalPrice.innerHTML = `Ценность: ${coinImg} ${unitPrice} / шт.`;
        itemModalContent.style.borderColor = tierColors[tier];
        sellBtn.style.display = 'inline-block';
        let sellBox=document.getElementById('item-sell-quantity');
        if(!sellBox){sellBox=document.createElement('div');sellBox.id='item-sell-quantity';sellBtn.parentNode.insertBefore(sellBox,sellBtn);}
        sellBox.innerHTML=`<div class="item-sell-count-head"><span>ПРОДАТЬ</span><b id="item-sell-count">1</b></div><input id="item-sell-range" type="range" min="1" max="${Math.max(1,currentSellStackIndices.length)}" value="1" step="1" oninput="updateItemSellQuantity(this.value)"><div class="item-sell-range-labels"><span>1</span><span>${currentSellStackIndices.length}</span></div><div id="item-sell-total">ИТОГО: ${coinImg} ${unitPrice}</div>`;
    } else {
        currentSellStackIndices = [];
        currentSellQuantity = 1;
        const sellBox=document.getElementById('item-sell-quantity'); if(sellBox)sellBox.innerHTML='';
        modalImage.className = 'modal-image item-atlas'; modalImage.style.display = item.image ? 'block' : 'none'; setItemAtlasElement(modalImage, item.image || item.id);
        modalName.textContent = item.name;
        modalTier.textContent = 'Все редкости';
        modalTier.style.color = '#fff';
        let pricesHTML = 'Цены по редкости:<br>';
        for (let t = 1; t <= 6; t++) {
            if (item.tiers?.[t]) pricesHTML += `<span style="color:${tierColors[t]}">${tierNames[t]}: ${coinImg} ${item.tiers[t].price}</span><br>`;
        }
        modalChance.innerHTML = pricesHTML;
        modalPrice.textContent = '';
        itemModalContent.style.borderColor = '#fff';
        sellBtn.style.display = 'none';
    }
    itemModal.classList.add('show'); 
}

function closeModal() { 
    const modal = document.getElementById('item-modal');
    if (modal) modal.classList.remove('show'); 
}

function updateItemSellQuantity(value){
    const max=Math.max(1,currentSellStackIndices.length);
    currentSellQuantity=Math.max(1,Math.min(max,Math.floor(Number(value)||1)));
    const count=document.getElementById('item-sell-count'); if(count)count.textContent=currentSellQuantity;
    const unit=Number(currentModalItem?.tiers?.[String(GameState.inventory[currentSellStackIndices[0]]?.tier)]?.price||0);
    const total=document.getElementById('item-sell-total'); if(total)total.innerHTML=`ИТОГО: <img src="png/ui/coin.png" style="width:15px;height:15px;vertical-align:middle;"> ${unit*currentSellQuantity}`;
}
async function sellItem() {
    if (!currentModalItemIsFromInventory || !currentSellStackIndices.length) { playError(); return; }
    const indices=currentSellStackIndices.slice(0,currentSellQuantity);
    const totalPrice=indices.reduce((sum,idx)=>{const it=GameState.inventory[idx];return sum+(it?Number(getItemById(it.id)?.tiers?.[String(it.tier)]?.price||0):0)},0);
    closeModal();
    openConfirmModal(`Продать ${indices.length} шт. за ${totalPrice} монет?`, async()=>{
        try { const data=await gameAction('sell',{indices}); closeModal(); updateBalance(); showNotification(`ПРОДАНО! +${data.result?.coins||totalPrice} МОНЕТ`); renderProfile(); }
        catch(e){playError();showNotification(e.message||'Не удалось продать предметы');}
    });
}

function openAvatarsModal() { 
    renderAvatarsModal(); 
    const modal = document.getElementById('avatars-modal');
    if (modal) modal.classList.add('show'); 
}

function closeAvatarsModal() { 
    const modal = document.getElementById('avatars-modal');
    if (modal) modal.classList.remove('show'); 
}

function renderAvatarsModal() { 
    const grid = document.getElementById('avatars-grid-modal'); 
    if (!grid) return;
    
    grid.innerHTML = ''; 
    const fragment = document.createDocumentFragment();
    
    if (!AVATARS_DATABASE.avatars) return;
    
    AVATARS_DATABASE.avatars.forEach(avatar => { 
        const isOwned = GameState.ownedAvatars.includes(avatar.id); 
        const isSelected = GameState.selectedAvatar === avatar.id; 
        
        let statusHTML = ''; 
        if (isSelected) {
            statusHTML = '<div class="avatar-status-modal">ВЫБРАН</div>'; 
        } else if (isOwned) {
            statusHTML = '<div class="avatar-status-modal">В НАЛИЧИИ</div>'; 
        } else { 
            const currencyImg = avatar.currency === 'gems' ? 'png/ui/gem.png' : 'png/ui/coin.png'; 
            statusHTML = `<div class="avatar-price-modal ${avatar.currency === 'gems' ? 'gems' : ''}"><img src="${currencyImg}" alt="" onerror="this.style.display='none';"> ${avatar.price}</div>`; 
        } 
        
        const div = document.createElement('div'); 
        div.className = `avatar-card-modal ${isOwned ? 'owned' : ''} ${isSelected ? 'selected' : ''}`; 
        div.innerHTML = `
            ${avatarMarkup(avatar.image, 'avatar-image-modal')}
            ${statusHTML}
        `; 
        
        div.onclick = () => { 
            playClick(); 
            handleAvatarClick(avatar.id); 
        }; 
        
        fragment.appendChild(div); 
    }); 
    
    grid.appendChild(fragment);
}

async function handleAvatarClick(avatarId) {
    const avatar=getAvatarById(avatarId); if(!avatar){playError();return;}
    if(!GameState.ownedAvatars.includes(avatarId)){
        const priceText=avatar.currency==='gems'?`${avatar.price} ГЕМОВ`:`${avatar.price} МОНЕТ`;
        openConfirmModal(`Купить аватар за ${priceText}?`, async()=>{
            try { await gameAction('selectAvatar',{avatarId}); updateBalance(); renderProfile(); renderAvatarsModal(); showNotification('АВАТАР КУПЛЕН!'); }
            catch(e){playError();showNotification(e.message||'Не удалось купить аватар');}
        });
    } else {
        try { await gameAction('selectAvatar',{avatarId}); renderProfile(); renderAvatarsModal(); showNotification('АВАТАР СМЕНЕН!'); }
        catch(e){playError();showNotification(e.message||'Не удалось сменить аватар');}
    }
}

async function recycleArtifact(id){const qty=Math.floor(Number(document.getElementById('artifact-sale-range')?.value)||1);if(!confirm(`Продать системе ${qty} шт.? Действие нельзя отменить.`))return;try{const d=await idempotentApiAction('artifact_recycle','/api/artifacts/recycle',{artifactId:id,quantity:qty});applyServerState(d.state);closeSimpleGameModal();renderInventory();updateBalance();const b=document.getElementById('inventory-shard-balance');if(b)b.textContent=formatNumberFull(GameState.shards||0);showNotification(`ПОЛУЧЕНО +${d.reward} ОСКОЛКОВ`,2500);}catch(e){showNotification(e.message||'ОШИБКА ПРОДАЖИ',2800);}}
