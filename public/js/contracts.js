// js/contracts.js — СИСТЕМА КОНТРАКТОВ (бывший крафт)

const CONTRACT_NAMES = [
    'КОНТРАКТ',
    'ЗАПРОС',
    'ЗАПАС',
    'ОБМЕН',
    'ЗАДАНИЕ',
    'СДЕЛКА'
];

let selectedContractIndices = [];
let contractResultItem = null;
let contractTierFilter = 'all';

// ==================== ОТКРЫТИЕ/ЗАКРЫТИЕ ====================

function openContractModal() { 
    selectedContractIndices = []; 
    contractResultItem = null; 
    contractTierFilter = 'all';
    renderContractModal(); 
    
    const modal = document.getElementById('contract-modal');
    if (modal) modal.classList.add('show'); 
}

function closeContractModal() { 
    selectedContractIndices = [];
    contractResultItem = null;
    
    const modal = document.getElementById('contract-modal');
    if (modal) modal.classList.remove('show'); 
}

// ==================== РЕНДЕР ====================

function renderContractModal() { 
    const invContainer = document.getElementById('contract-inventory'); 
    if (!invContainer) return;
    
    invContainer.innerHTML = '';
    renderContractTierFilters();
    const fragment = document.createDocumentFragment();
    const filtered = GameState.inventory.map((item,index)=>({item,index})).filter(x=>x.item && (contractTierFilter==='all' || Number(x.item.tier)===Number(contractTierFilter)));
    filtered.forEach(({item,index}) => { 
        if (!item) return;
        
        const div = document.createElement('div'); 
        div.className = `contract-item tier-${Number(item.tier)||1}` + (selectedContractIndices.includes(index) ? ' selected' : ''); 
        
        if (selectedContractIndices.includes(index)) {
            div.classList.add('selected');
        }
        
        const itemData = getItemById(item.id); 
        const price = itemData?.tiers?.[item.tier]?.price || 0; 
        
        div.innerHTML = `
            <div class="contract-item-image-slot tier-${Number(item.tier)||1}" style="--tier-color:${tierColors[Number(item.tier)]||'#fff'}">${itemSprite(itemData?.image, 'contract-item-atlas')}</div>
            <div class="contract-item-name" title="${escapeHtml(itemData?.name||'Предмет')}">${escapeHtml(itemData?.name||'Предмет')}</div>
            <div class="contract-item-price"><img src="${PATHS.coin}" alt="" loading="lazy"> <span>${Number(price).toLocaleString('ru-RU')}</span></div>
        `; 
        
        div.onclick = () => { 
            playClick(); 
            toggleContractItem(index); 
        }; 
        
        fragment.appendChild(div); 
    }); 
    
    invContainer.appendChild(fragment);
    updateContractInfo(); 
}

function renderContractTierFilters(){
    const root=document.getElementById('contract-tier-filters');
    if(!root)return;
    const tiers=['all',1,2,3,4,5,6];
    root.innerHTML=tiers.map(t=>{const active=String(t)===String(contractTierFilter);const label=t==='all'?'ВСЕ':`T${t}`;const color=t==='all'?'var(--border-color)':(tierColors[Number(t)]||'var(--border-color)');return `<button type="button" class="contract-tier-filter ${active?'active':''}" data-tier="${t}" style="--tier-filter-color:${color}" onclick="playClick(); setContractTierFilter('${t}')">${label}</button>`;}).join('');
}
function setContractTierFilter(tier){
    contractTierFilter=['all','1','2','3','4','5','6'].includes(String(tier))?String(tier):'all';
    renderContractModal();
}

function toggleContractItem(index) { 
    if (selectedContractIndices.includes(index)) {
        selectedContractIndices = selectedContractIndices.filter(i => i !== index); 
    } else { 
        if (selectedContractIndices.length >= CONTRACT_MAX_ITEMS) { 
            playError(); 
            showNotification(`МАКСИМУМ ${CONTRACT_MAX_ITEMS} ПРЕДМЕТОВ`); 
            return; 
        } 
        selectedContractIndices.push(index); 
    } 
    renderContractModal(); 
}

function updateContractInfo() { 
    const fan = document.getElementById('contract-fan'); 
    const countEl = document.getElementById('contract-count');
    const totalEl = document.getElementById('contract-total');
    const expectedEl = document.getElementById('contract-expected');
    const startBtn = document.getElementById('contract-start-btn');
    const contractNameEl = document.getElementById('contract-name');
    
    if (!fan || !countEl || !totalEl || !expectedEl || !startBtn || !contractNameEl) return;
    
    fan.innerHTML = ''; 
    const count = selectedContractIndices.length; 
    countEl.textContent = count; 
    
    // Стабильное название до выполнения, чтобы рендер не менял контракт визуально
    const contractName = CONTRACT_NAMES[(selectedContractIndices.reduce((a, b) => a + b, 0) + count) % CONTRACT_NAMES.length];
    contractNameEl.textContent = contractName;
    
    let total = 0; 
    selectedContractIndices.forEach((invIdx) => { 
        const item = GameState.inventory[invIdx]; 
        if (!item) return;
        const itemData = getItemById(item.id); 
        total += itemData?.tiers?.[item.tier]?.price || 0; 
    }); 
    totalEl.textContent = total; 
    
    // Создаём веер карт
    const fragment = document.createDocumentFragment();
    const n = count; 
    const maxAngle = n <= 1 ? 0 : 30; 
    const step = n > 1 ? (2 * maxAngle) / (n - 1) : 0; 
    const startAngle = -maxAngle; 
    
    selectedContractIndices.forEach((invIdx, order) => { 
        const item = GameState.inventory[invIdx]; 
        if (!item) return;
        
        const card = document.createElement('div'); 
        card.className = 'contract-fan-card'; 
        card.style.borderColor = tierColors[item.tier] || '#fff'; 
        
        const angle = n <= 1 ? 0 : startAngle + step * order; 
        card.style.left = '50%'; 
        card.style.bottom = '25px'; 
        card.style.transform = `translateX(-50%) rotate(${angle}deg)`; 
        card.style.zIndex = order; 
        
        const itemData = getItemById(item.id) || {};
        card.innerHTML = `<div class="contract-fan-image-slot tier-${Number(item.tier)||1}" style="--tier-color:${tierColors[Number(item.tier)]||'#fff'}">${itemSprite(itemData.image, 'contract-item-atlas')}</div>`; 
        fragment.appendChild(card); 
    }); 
    fan.appendChild(fragment);
    
    // Информация о возможном выигрыше
    const minWin = Math.round(total * 0.55);
    const maxWin = Math.round(total * 1.75);
    expectedEl.innerHTML = `<span>ДИАПАЗОН: ${minWin.toLocaleString('ru-RU')}–${maxWin.toLocaleString('ru-RU')}</span> <img src="${PATHS.coin}" alt="" class="contract-coin-icon"> <small>Результат рассчитывается сервером.</small>`; 
    
    // Кнопка
    startBtn.disabled = count < CONTRACT_MIN_ITEMS || count > CONTRACT_MAX_ITEMS; 
}

// ==================== ВЫПОЛНЕНИЕ КОНТРАКТА ====================

function startContract() { 
    if (selectedContractIndices.length < CONTRACT_MIN_ITEMS || selectedContractIndices.length > CONTRACT_MAX_ITEMS) { 
        playError(); 
        return; 
    } 
    
    playClick();
    const contractIndices = [...selectedContractIndices]; 
    
    const prepareOverlay = document.getElementById('contract-prepare-overlay');
    const explosion = document.getElementById('contract-explosion');
    
    if (prepareOverlay) prepareOverlay.classList.add('show'); 
    closeContractModal(); 
    
    setTimeout(() => { 
        if (prepareOverlay) prepareOverlay.classList.remove('show'); 
        if (explosion) explosion.classList.add('show'); 
        
        setTimeout(() => { 
            if (explosion) explosion.classList.remove('show'); 
            performContractCalculation(contractIndices); 
        }, 400); 
    }, 1200); 
}

async function performContractCalculation(indices) {
    try {
        const data=await gameAction('contract',{indices});
        const itemDef=getItemById(data.result.item?.id)||data.result.item;
        const match={item:itemDef,tier:data.result.tier};
        contractResultItem=match;
        renderProfile?.();
        playContractComplete();
        showContractResult(match,data.result.targetPrice,data.result.inputValue,data.result.resultPrice,data.result.profit);
    } catch(e) { playError(); showNotification(e.message||'Не удалось выполнить контракт'); }
    selectedContractIndices=[];
}

function showContractResult(match, targetPrice, inputValue, resultPriceValue, profit) { 
    const overlay = document.getElementById('contract-result-overlay'); 
    const resultImg = document.getElementById('contract-result-img');
    const resultName = document.getElementById('contract-result-name');
    const resultTier = document.getElementById('contract-result-tier');
    const resultPrice = document.getElementById('contract-result-price');
    
    if (!overlay || !resultImg || !resultName || !resultTier || !resultPrice) return;
    
    setItemAtlasElement(resultImg, match.item.image || match.item.id);
    resultImg.style.display = match.item.image ? 'block' : 'none';
    resultName.textContent = match.item.name; 
    resultTier.textContent = tierNames[match.tier]; 
    resultTier.style.color = tierColors[match.tier]; 
    const itemValue = Math.max(0, Math.round(Number(resultPriceValue)||Number(match.item?.tiers?.[match.tier]?.price)||0));
    const input = Math.max(0, Math.round(Number(inputValue)||0));
    const net = Number.isFinite(Number(profit)) ? Math.round(Number(profit)) : itemValue - input;
    const sign = net >= 0 ? '+' : '';
    const netClass = net >= 0 ? 'contract-profit-plus' : 'contract-profit-minus';
    resultPrice.innerHTML = `<div class="contract-result-row"><span>СТОИМОСТЬ ВНЕСЁННЫХ</span><b>${input.toLocaleString('ru-RU')} <img src="${PATHS.coin}" alt="" style="width:14px;height:14px;vertical-align:-3px"></b></div><div class="contract-result-row"><span>ЦЕНА ПРЕДМЕТА</span><b>${itemValue.toLocaleString('ru-RU')} <img src="${PATHS.coin}" alt="" style="width:14px;height:14px;vertical-align:-3px"></b></div><div class="contract-result-net ${netClass}"><span>ОКУП</span><b>${sign}${net.toLocaleString('ru-RU')} <img src="${PATHS.coin}" alt="" style="width:14px;height:14px;vertical-align:-3px"></b></div>`; 
    
    overlay.classList.add('show'); 
    
    if (match.tier >= 4) {
        spawnConfetti();
    }
}

function closeContractResult() { 
    const overlay = document.getElementById('contract-result-overlay');
    if (overlay) overlay.classList.remove('show'); 
    contractResultItem = null; 
}

console.log('[CONTRACTS] Модуль контрактов загружен');