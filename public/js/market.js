// js/market.js — РЫНОК АРТЕФАКТОВ 
let marketMode='browse';
let marketSelectedArtifact=0;
let marketData={listings:[],stats:{},history:{},book:{},depth:{},artifacts:[]};
let marketBusy=false;
let marketSearchTerm='';
let marketSort='price_asc';
let marketFilter='all';
let marketDetailTab='listings';
let marketMobileDetail=false;

let marketSearchTimer=null;
function marketSearch(value){
  marketSearchTerm=String(value||'');
  clearTimeout(marketSearchTimer);
  marketSearchTimer=setTimeout(()=>{
    const input=document.querySelector('.market-v4-search input');
    if(input&&document.activeElement===input)return; // Do not replace focused native Android input.
    renderMarket();
  },220);
  const list=document.querySelector('.market-v4-artifacts');
  if(list){for(const card of list.querySelectorAll('.market-v4-artifact')){const name=card.dataset.name||'';card.hidden=!name.includes(marketSearchTerm.toLowerCase().trim());}}
}
function marketArtifact(id){return (ARTIFACTS_DATABASE.artifacts||[]).find(a=>Number(a.id)===Number(id));}
function artifactInventoryCount(id){return Number(GameState.artifacts?.find(a=>Number(a.id)===Number(id))?.count||0);}
function marketSortRows(rows){const a=[...(rows||[])];if(marketSort==='price_desc')return a.sort((x,y)=>Number(y.price)-Number(x.price)||Number(x.createdAt)-Number(y.createdAt));if(marketSort==='newest')return a.sort((x,y)=>Number(y.createdAt)-Number(x.createdAt)||Number(y.id)-Number(x.id));if(marketSort==='oldest')return a.sort((x,y)=>Number(x.createdAt)-Number(y.createdAt)||Number(x.id)-Number(y.id));return a.sort((x,y)=>Number(x.price)-Number(y.price)||Number(x.createdAt)-Number(y.createdAt)||Number(x.id)-Number(y.id));}
function marketRowsFor(id){return marketSortRows((marketData.listings||[]).filter(x=>x.currency!=='gems'&&Number(x.artifactId)===Number(id)));}
async function loadMarket(artifactId=0){marketData=await apiRequest('/api/market?limit=120'+(artifactId?'&artifact='+Number(artifactId):''));return marketData;}
async function openMarket(){const m=document.getElementById('market-modal');if(!m)return;m.classList.add('show');m.setAttribute('aria-hidden','false');marketMobileDetail=false;try{await loadMarket();renderMarket();}catch(e){showNotification(e.message||'НЕ УДАЛОСЬ ОТКРЫТЬ РЫНОК',3000);}}
function closeMarket(){document.getElementById('market-modal')?.classList.remove('show');document.getElementById('market-modal')?.setAttribute('aria-hidden','true');}
function setMarketMode(mode){playClick();marketMode=['browse','mine'].includes(mode)?mode:'browse';marketMobileDetail=false;renderMarket();}
async function selectMarketArtifact(id){marketSelectedArtifact=Number(id)||0;marketMobileDetail=true;marketDetailTab='listings';try{await loadMarket(marketSelectedArtifact);}catch(e){showNotification(e.message||'НЕ УДАЛОСЬ ОБНОВИТЬ РЫНОК',2500);}renderMarket();}
async function marketBackToArtifacts(){marketMobileDetail=false;try{await loadMarket();}catch(e){}renderMarket();}
function setMarketSort(v){playClick();marketSort=['price_asc','price_desc','newest','oldest'].includes(v)?v:'price_asc';renderMarket();}
function setMarketFilter(v){playClick();marketFilter=['all','listed'].includes(v)?v:'all';renderMarket();}
function setMarketDetailTab(v){playClick();marketDetailTab=['listings','about'].includes(v)?v:'listings';renderMarket();}
function marketGem(n){return `<span class="market-gem"><img src="png/ui/shards.png" class="market-shard-icon" alt="осколки"><b class="market-gem-value">${marketFormatPrice(n)}</b></span>`;}
function marketWallet(){return `<div class="market-v4-wallet">${marketGem(GameState.shards||0)}<button class="market-refresh" onclick="playClick();refreshMarket()" aria-label="Обновить">↻</button></div>`;}
function marketShortName(name){return String(name||'').trim().split(/\s+/).map(w=>w[0]||'').join('.').toLocaleUpperCase('ru-RU')+'.';}
function marketFormatPrice(n){return formatNumberFull(Number.isFinite(Number(n))?Math.max(0,Math.floor(Number(n))):0);}
function marketArtifactStats(id){return marketData.stats?.[id]||null;}
function marketCheapest(rows){return [...(rows||[])].sort((a,b)=>Number(a.price)-Number(b.price)||Number(a.createdAt)-Number(b.createdAt))[0]||null;}
function marketFilteredArtifacts(){
  const all=marketData.artifacts||ARTIFACTS_DATABASE.artifacts||[],term=marketSearchTerm.trim().toLowerCase();
  return all.filter(a=>{
    if(term&&!String(a.name||'').toLowerCase().includes(term))return false;
    const rows=(marketData.listings||[]).filter(x=>x.currency!=='gems'&&Number(x.artifactId)===Number(a.id));
    if(marketFilter==='listed'&&!Number(marketData.book?.[a.id]?.count||0))return false;
    if(marketFilter==='owned'&&artifactInventoryCount(a.id)<1)return false;
    return true;
  }).sort((a,b)=>{
    const ar=marketData.book?.[a.id],br=marketData.book?.[b.id];
    if(marketSort==='price_asc')return Number(ar?.minPrice||Infinity)-Number(br?.minPrice||Infinity)||String(a.name).localeCompare(String(b.name),'ru');
    if(marketSort==='price_desc')return Number(br?.minPrice||-1)-Number(ar?.minPrice||-1)||String(a.name).localeCompare(String(b.name),'ru');
    if(marketSort==='newest')return Number(br?.createdAt||0)-Number(ar?.createdAt||0)||Number(b.id)-Number(a.id);
    if(marketSort==='oldest')return Number(ar?.createdAt||Infinity)-Number(br?.createdAt||Infinity)||Number(a.id)-Number(b.id);
    return Number(a.id)-Number(b.id);
  });
}
function renderMarket(){
  const b=document.getElementById('market-body');if(!b)return;
  const defs=marketFilteredArtifacts();
  const total=(marketData.listings||[]).filter(x=>x.currency!=='gems').length;
  const mine=(marketData.listings||[]).filter(x=>x.isMine).length;
  if(!defs.length&&marketMode==='browse'){
    b.innerHTML=`<div class="market-v4 market-empty-state"><b>НЕТ АРТЕФАКТОВ</b><button class="market-v4-btn" onclick="playClick();marketSearchTerm='';marketFilter='all';renderMarket()">СБРОСИТЬ</button></div>`;
    return;
  }
  if(!marketSelectedArtifact||!defs.some(a=>Number(a.id)===Number(marketSelectedArtifact)))marketSelectedArtifact=Number(defs[0].id);
  const selected=marketArtifact(marketSelectedArtifact);
  const rows=marketRowsFor(marketSelectedArtifact),cheap=marketCheapest(rows.filter(x=>!x.isMine)),stats=marketArtifactStats(marketSelectedArtifact);

  // Всегда переключаем рынок на отдельный экран выбранного артефакта.
  // Это убирает каталог с экрана покупки и не смешивает разные предметы.
  if(marketMobileDetail&&selected){
    b.innerHTML=`<div class="market-v4 market-detail-screen">
      <header class="market-v4-head"><button class="market-v4-back" onclick="playClick();marketBackToArtifacts()"><span aria-hidden="true">←</span> АРТЕФАКТЫ</button>${marketWallet()}</header>
      ${renderMarketDetail(selected,rows,cheap,stats)}
    </div>`;
    return;
  }

  b.innerHTML=`<div class="market-v4 market-catalog-screen">
    <header class="market-v4-head"><nav class="market-trade-nav" aria-label="Разделы рынка"><button class="${marketMode==='browse'?'active':''}" onclick="setMarketMode('browse')">РЫНОК</button><button class="${marketMode==='mine'?'active':''}" onclick="setMarketMode('mine')">МОИ ЛОТЫ${mine?`<span class="market-tab-badge">${mine}</span>`:''}</button></nav>${marketWallet()}</header>
    ${marketMode==='mine'?renderMyMarket(ARTIFACTS_DATABASE.artifacts||[]):`<section class="market-v4-browser">
      <div class="market-v4-filters"><label class="market-search market-v4-search"><input type="search" value="${escapeHtml(marketSearchTerm)}" placeholder="Поиск артефакта" aria-label="Поиск артефакта" autocomplete="off" enterkeyhint="search" oninput="marketSearch(this.value)"></label><div class="market-chips"><button class="${marketFilter==='all'?'active':''}" onclick="setMarketFilter('all')">ВСЕ</button><button class="${marketFilter==='listed'?'active':''}" onclick="setMarketFilter('listed')">В ПРОДАЖЕ · ${total}</button></div><select aria-label="Сортировка" onchange="setMarketSort(this.value)"><option value="price_asc" ${marketSort==='price_asc'?'selected':''}>ДЕШЕВЛЕ</option><option value="price_desc" ${marketSort==='price_desc'?'selected':''}>ДОРОЖЕ</option><option value="newest" ${marketSort==='newest'?'selected':''}>НОВЫЕ</option></select></div>
      <div class="market-v4-artifacts">${defs.map(a=>renderMarketArtifactCard(a)).join('')}</div>
    </section>`}
  </div>`;
}
function renderMarketArtifactCard(a){
  const rows=(marketData.listings||[]).filter(x=>x.currency!=='gems'&&Number(x.artifactId)===Number(a.id));
  const cheap=marketCheapest(rows),owned=artifactInventoryCount(a.id),book=marketData.book?.[a.id]||{};
  return `<button type="button" class="market-v4-artifact${book.count?'':' is-empty'}" data-name="${escapeHtml(String(a.name||'').toLowerCase())}" aria-label="${escapeHtml(a.name)}. ${book.count?'Цена '+marketFormatPrice(book.minPrice)+' осколков':'Нет лотов'}" onclick="playClick();selectMarketArtifact(${Number(a.id)})">
    <span class="market-v4-artifact-img">${artifactSprite(a.id)}</span><span class="market-v4-artifact-short">${escapeHtml(a.name)}</span>
    <span class="market-v4-artifact-price">${book.count?marketGem(book.minPrice):'<small>НЕТ ЛОТОВ</small>'}</span>
    ${book.count?`<span class="market-v4-owned">×${book.count}</span>`:''}${owned?`<span class="market-v4-mine-badge" title="У тебя">${owned}</span>`:''}
  </button>`;
}
function renderMarketDetail(a,rows,cheap,stats){
 const inv=artifactInventoryCount(a.id);
 return `<main class="market-v4-detail">
   <section class="market-v4-artifact-hero"><div class="market-v4-hero-img">${artifactSprite(a.id)}</div><div class="market-v4-hero-copy"><small>АРТЕФАКТ</small><h1>${escapeHtml(a.name)}</h1><div class="market-v4-hero-meta"><span class="market-v4-count">НА РЫНКЕ <b>×${Number(marketData.book?.[a.id]?.count||0)}</b></span><span class="market-v4-count">У ТЕБЯ <b>×${inv}</b></span></div></div></section>
   <div class="market-v4-detail-tabs" role="tablist"><button class="${marketDetailTab==='listings'?'active':''}" onclick="setMarketDetailTab('listings')">ЛОТЫ</button><button class="${marketDetailTab==='about'?'active':''}" onclick="setMarketDetailTab('about')">ИНФО</button></div>
   ${marketDetailTab==='listings'?renderMarketListings(a.id,rows,cheap):renderMarketAbout(a,inv,stats)}
   <div class="market-v4-sellbar"><button ${inv<1?'disabled':''} onclick="playClick();openMarketSellPrompt(${a.id})">+ ПРОДАТЬ</button></div>
 </main>`;
}
function renderMarketListings(id,rows,cheap){
 const count=Number(marketData.book?.[id]?.count||0), available=marketCheapest(rows.filter(x=>!x.isMine)),buying=!!available;
 return `<section class="market-simple-trade"><div class="market-simple-quote${available?'':' is-empty'}"><small>ЛУЧШАЯ ЦЕНА</small><strong>${available?marketGem(available.price):'НЕТ ДОСТУПНЫХ ЛОТОВ'}</strong><span>ЛОТОВ НА РЫНКЕ ×${count}${count&&!available?' · ТОЛЬКО ВАШИ':''}</span></div>
 <button class="market-simple-buy" ${!buying||marketBusy?'disabled':''} onclick="playClick();buyCheapestArtifact(${Number(id)})">${buying?'КУПИТЬ':'НЕТ ДОСТУПНЫХ ЛОТОВ'}</button>
 <div id="market-transaction-status" class="market-transaction-status" role="status" aria-live="polite"></div>
 ${renderMarketChart(id)}</section>`;
}
function renderMarketAbout(a,inv,stats){const sales=marketData.history?.[a.id]||[];return `<div class="market-v4-about"><small>ОБ АРТЕФАКТЕ</small><h3>${escapeHtml(a.name)}</h3><p>Артефакт можно хранить в коллекции и продавать другим игрокам за осколки. Цена формируется игроками, поэтому на рынке могут быть сильные различия между лотами.</p><div class="market-v4-about-grid"><div><small>У ТЕБЯ</small><b>×${inv}</b></div><div><small>СРЕДНЯЯ ЦЕНА</small><b>${stats?.avg?marketFormatPrice(stats.avg):'—'}</b></div><div><small>ПРОДАЖ</small><b>${stats?.sales||0}</b></div></div><section class="market-v4-sales-history"><h4>ПОСЛЕДНИЕ ПРОДАЖИ</h4>${sales.length?sales.map(x=>`<div><span>${new Date(x.recordedAt).toLocaleString('ru-RU')}</span><b>${marketFormatPrice(x.price)} оск.</b><small>×${x.quantity}</small></div>`).join(''):'<p>Пока нет завершённых продаж по этому артефакту.</p>'}</section></div>`;}
function renderMarketChart(id){
 const points=marketData.depth?.[id]||[];
 if(!points.length)return '<div class="market-v4-empty market-chart-empty">АКТИВНЫХ ЛОТОВ НЕТ</div>';
 const max=Math.max(1,...points.map(p=>Number(p.quantity)||0));
 return `<div class="market-v4-chart market-depth-chart"><header><b>ЦЕНЫ НА РЫНКЕ</b><div class="market-depth-legend">ВЫСОТА — ЛОТЫ · ПОДПИСЬ — ЦЕНА</div></header><section>${points.map(p=>`<div class="market-depth-column" title="${marketFormatPrice(p.price)} осколков · ${p.quantity} лотов"><small>${p.quantity} шт.</small><i style="height:${Math.max(8,Math.round(p.quantity/max*100))}%"></i><em>${marketFormatPrice(p.price)}</em></div>`).join('')}</section></div>`;
}
function renderMyMarket(defs){
 const mine=(marketData.listings||[]).filter(x=>x.isMine),grouped=new Map();
 for(const x of mine){if(!grouped.has(x.artifactId))grouped.set(x.artifactId,[]);grouped.get(x.artifactId).push(x);}
 const cards=[...grouped.entries()].map(([id,rows])=>{const a=marketArtifact(id);if(!a)return '';return `<article class="market-my-grid-card"><div class="market-my-grid-visual">${artifactSprite(a.id)}</div><div class="market-my-grid-info"><b>${escapeHtml(a.name)}</b><small>ЛОТОВ ×${rows.length}</small></div>${marketSortRows(rows).map(x=>`<div class="market-my-grid-line market-v4-listing">${x.currency==='gems'?`<span class="market-legacy-price">СТАРЫЙ ЛОТ · ТОЛЬКО СНЯТИЕ</span>`:marketGem(x.price)}<button class="market-cancel-btn" onclick="playClick();cancelMarketListing(${Number(x.id)})">СНЯТЬ</button></div>`).join('')}</article>`;}).join('');
 const inventory=(defs||[]).filter(a=>artifactInventoryCount(a.id)>0).map(a=>`<button class="market-my-grid-card market-my-sell" onclick="playClick();openMarketSellPrompt(${Number(a.id)})"><div class="market-my-grid-visual">${artifactSprite(a.id)}</div><b>${escapeHtml(a.name)}</b><small>×${artifactInventoryCount(a.id)} В НАЛИЧИИ</small><strong>+ ВЫСТАВИТЬ</strong></button>`).join('');
 return `<section class="market-my-screen"><h3>НА ПРОДАЖЕ <span>${mine.length}</span></h3><div class="market-my-grid market-my-listings">${cards||'<div class="market-r-empty">АКТИВНЫХ ЛОТОВ НЕТ</div>'}</div><h3>ВЫСТАВИТЬ ИЗ ИНВЕНТАРЯ</h3><div class="market-my-grid market-my-inventory">${inventory||'<div class="market-r-empty">АРТЕФАКТОВ НЕТ</div>'}</div></section>`;
}
async function refreshMarket(){if(marketBusy)return;marketBusy=true;try{await loadMarket(marketMobileDetail?marketSelectedArtifact:0);renderMarket();}catch(e){showNotification(e.message||'ОШИБКА РЫНКА',2800);}finally{marketBusy=false;}}
function openMarketSellPrompt(id){const a=marketArtifact(id);if(!a||artifactInventoryCount(id)<1){showNotification('НЕТ ЭТОГО АРТЕФАКТА',2500);return;}const m=document.getElementById('market-price-modal'),box=document.getElementById('market-price-artifact'),input=document.getElementById('market-price-input');if(!m||!box||!input)return;const rows=marketRowsFor(id),cheap=marketCheapest(rows);box.innerHTML=`${artifactSprite(a.id)}<div><b>${escapeHtml(a.name)}</b><small>ДОСТУПНО ×${artifactInventoryCount(id)}</small></div>`;input.value='';input.placeholder=cheap?`СЕЙЧАС ${marketFormatPrice(cheap.price)} ОСКОЛКОВ`:'ВВЕДИ ЦЕНУ';input.dataset.artifactId=String(id);m.classList.add('show');m.setAttribute('aria-hidden','false');setTimeout(()=>input.focus(),50);}
function closeMarketSellPrompt(){document.getElementById('market-price-modal')?.classList.remove('show');document.getElementById('market-price-modal')?.setAttribute('aria-hidden','true');}

let pendingMarketActionRequest=null;
async function sendMarketAction(action,payload){
 const fingerprint=`${action}:${JSON.stringify(payload||{})}`,storageKey='zombixPendingMarketActionV1';
 let key=pendingMarketActionRequest?.fingerprint===fingerprint?pendingMarketActionRequest.key:null;
 if(!key){try{const stored=JSON.parse(sessionStorage.getItem(storageKey)||'null');if(stored?.fingerprint===fingerprint)key=stored.key;}catch{}}
 if(!key){try{key=crypto.randomUUID()}catch{}if(!key)key=`mkt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,14)}`;}
 pendingMarketActionRequest={fingerprint,key};try{sessionStorage.setItem(storageKey,JSON.stringify(pendingMarketActionRequest))}catch{}
 const data=await apiRequest('/api/market/action',{method:'POST',body:JSON.stringify({action,payload,idempotencyKey:key})});
 if(pendingMarketActionRequest?.key===key)pendingMarketActionRequest=null;
 try{const stored=JSON.parse(sessionStorage.getItem(storageKey)||'null');if(stored?.key===key)sessionStorage.removeItem(storageKey)}catch{}
 return data;
}

async function submitMarketSell(){const input=document.getElementById('market-price-input'),id=Math.floor(Number(input?.dataset.artifactId)||0),price=Math.floor(Number(input?.value)||0);if(!id||!Number.isFinite(price)||price<1||price>1000000){showNotification('ЦЕНА: ОТ 1 ДО 1 000 000 ОСКОЛКОВ',2400);return;}if(marketBusy)return;marketBusy=true;try{const d=await sendMarketAction('list',{artifactId:id,price});applyServerState(d.state);closeMarketSellPrompt();await loadMarket();marketSelectedArtifact=id;marketMobileDetail=true;marketMode='browse';renderMarket();showNotification(`АРТЕФАКТ ВЫСТАВЛЕН · ${marketFormatPrice(price)} ОСКОЛКОВ`,2800);updateBalance();}catch(e){playError();showNotification(e.message||'НЕ УДАЛОСЬ ВЫСТАВИТЬ ЛОТ',3200);}finally{marketBusy=false;}}
async function buyCheapestArtifact(id){
 if(marketBusy)return;marketBusy=true;
 const status=document.getElementById('market-transaction-status');if(status){status.textContent='ИДЁТ ТРАНЗАКЦИЯ…';status.classList.add('pending');}
 document.querySelectorAll('.market-simple-buy').forEach(b=>b.disabled=true);
 try{const d=await sendMarketAction('buy_cheapest',{artifactId:Number(id)});
 applyServerState(d.state);await loadMarket(id);marketSelectedArtifact=id;marketMobileDetail=true;marketDetailTab='listings';renderMarket();playWinSound();showNotification(`ПОКУПКА УСПЕШНА · −${marketFormatPrice(d.result?.price||0)} ОСКОЛКОВ`,3200);updateBalance();
 }catch(e){playError();showNotification(e.message||'ПОКУПКА НЕ УДАЛАСЬ · ПОПРОБУЙ ЕЩЁ РАЗ',3500);await loadMarket().catch(()=>{});renderMarket();}finally{marketBusy=false;}
}
async function cancelMarketListing(id){if(marketBusy)return;marketBusy=true;try{const d=await sendMarketAction('cancel',{listingId:Number(id)});applyServerState(d.state);await loadMarket();renderMarket();showNotification('ЛОТ СНЯТ · АРТЕФАКТ ВЕРНУЛСЯ В ИНВЕНТАРЬ',2800);updateBalance();}catch(e){playError();showNotification(e.message||'ЛОТ УЖЕ НЕДОСТУПЕН',3000);}finally{marketBusy=false;}}
